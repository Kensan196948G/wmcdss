"""Periodic job: fetch latest JMA wave nowcast for each marine-enabled site.

Kept separate from `ingest_jma` (AMeDAS) because:
  - upstream contract is different (gridded JSON, hourly cadence)
  - site selection criterion differs (`wave_grid_lat IS NOT NULL`)
  - failure surface is different (URL contract still operator-verified)

Invoked by systemd timer (`deploy/systemd/wmcdss-jma-fetch-marine.timer`) or
manually:

    python -m app.jobs.ingest_jma_marine

Idempotent: relies on the (site_id, observed_at, data_version) ON CONFLICT
upsert, so re-running the same hour is safe.
"""
from __future__ import annotations
import asyncio
import logging
import sys

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.observations import MarineObservation
from app.models.site import Site
from app.services import jma_wave as wave_svc
from app.services.audit import write_audit

log = logging.getLogger("wmcdss.jobs.ingest_jma_marine")

# Matches the AMeDAS ingester's tolerated-fault list. Diverging from it
# silently would create a surprise during incident triage.
_FETCH_TOLERATED = (
    httpx.TimeoutException,
    httpx.ConnectError,
    httpx.ReadError,
    httpx.RemoteProtocolError,
)


async def _upsert_marine(db: AsyncSession, row: dict) -> None:
    stmt = pg_insert(MarineObservation).values([row])
    update_cols = {
        c.name: stmt.excluded[c.name]
        for c in MarineObservation.__table__.columns
        if c.name not in {"id", "fetched_at", "site_id", "observed_at", "data_version"}
    }
    await db.execute(stmt.on_conflict_do_update(
        index_elements=["site_id", "observed_at", "data_version"],
        set_=update_cols,
    ))


async def run_once() -> int:
    """Fetch latest wave nowcast for every site with wave_grid_lat set.

    Returns the count of rows written. Always writes an audit row so a
    silently-failing run is distinguishable from a "no marine sites" run.
    """
    settings = get_settings()
    written = 0
    fetch_failed = 0
    upsert_failed = 0
    no_data = 0
    upstream_4xx = 0
    upstream_5xx = 0

    async with SessionLocal() as db:
        sites = (await db.execute(
            select(Site).where(
                Site.wave_grid_lat.isnot(None),
                Site.wave_grid_lon.isnot(None),
            )
        )).scalars().all()

        if not sites:
            log.info("no sites with wave_grid_lat/lon; nothing to fetch")
            # Still audit — distinguishes "no marine sites configured" from
            # "ingester never ran".
            try:
                await write_audit(
                    db, actor="jma_fetcher", action="observation.marine.ingest",
                    target_type="marine_observation", target_id=None,
                    detail={"sites_total": 0, "source": "jma_wave"},
                )
                await db.commit()
            except SQLAlchemyError as exc:
                log.error("marine ingest audit/commit failed: %s", exc)
                await db.rollback()
                raise
            return 0

        async with httpx.AsyncClient(
            headers={"User-Agent": settings.jma_user_agent}
        ) as client:
            for site in sites:
                lat, lon = site.wave_grid_lat, site.wave_grid_lon
                try:
                    result = await wave_svc.fetch_latest(client, lat, lon)
                except httpx.HTTPStatusError as exc:
                    code = exc.response.status_code
                    if 400 <= code < 500:
                        upstream_4xx += 1
                    elif 500 <= code < 600:
                        upstream_5xx += 1
                    log.error("jma_wave upstream %s site=%s grid=%s,%s url=%s",
                              code, site.code, lat, lon, exc.request.url)
                    fetch_failed += 1
                    continue
                except _FETCH_TOLERATED as exc:
                    log.warning("jma_wave transient site=%s grid=%s,%s: %s",
                                site.code, lat, lon, exc)
                    fetch_failed += 1
                    continue
                # Other exceptions (programming bug, schema drift, OOM…) propagate.

                if not result:
                    log.info("no data site=%s grid=%s,%s", site.code, lat, lon)
                    no_data += 1
                    continue

                observed_at, entry = result
                row = wave_svc.normalise(
                    entry, observed_at, str(site.id),
                    grid_lat=lat, grid_lon=lon,
                )
                try:
                    async with db.begin_nested():
                        await _upsert_marine(db, row)
                    written += 1
                except SQLAlchemyError as exc:
                    log.warning("marine upsert failed site=%s: %s", site.code, exc)
                    upsert_failed += 1
                    continue

            try:
                await write_audit(
                    db, actor="jma_fetcher", action="observation.marine.ingest",
                    target_type="marine_observation", target_id=None,
                    detail={
                        "written": written,
                        "fetch_failed": fetch_failed,
                        "upsert_failed": upsert_failed,
                        "no_data": no_data,
                        "upstream_4xx": upstream_4xx,
                        "upstream_5xx": upstream_5xx,
                        "sites_total": len(sites),
                        "source": "jma_wave",
                    },
                )
                await db.commit()
            except SQLAlchemyError as exc:
                log.error("marine ingest audit/commit failed: %s", exc)
                await db.rollback()
                raise

    log.info(
        "ingest_jma_marine: wrote=%d fetch_failed=%d (4xx=%d 5xx=%d) "
        "upsert_failed=%d no_data=%d",
        written, fetch_failed, upstream_4xx, upstream_5xx,
        upsert_failed, no_data,
    )
    return written


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    try:
        n = asyncio.run(run_once())
    except Exception as exc:
        log.error("ingest_jma_marine crashed: %s", exc, exc_info=True)
        return 1
    return 0 if n >= 0 else 1


if __name__ == "__main__":
    sys.exit(main())
