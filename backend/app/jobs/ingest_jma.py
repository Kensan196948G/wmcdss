"""Periodic job: fetch latest AMeDAS observation for each site and upsert.

Invoked by systemd timer (`deploy/systemd/wmcdss-jma-fetch.timer`) or manually:

    python -m app.jobs.ingest_jma

Idempotent: relies on the (site_id, observed_at, data_version) ON CONFLICT
upsert in app.api.observations, so re-running the same 10-min window is safe.
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
from app.models.observations import WeatherObservation
from app.models.site import Site
from app.services import jma as jma_svc
from app.services.audit import write_audit

log = logging.getLogger("wmcdss.jobs.ingest_jma")

# Per-site fetch failures we tolerate (skip site, keep going).
# Anything else bubbles up so systemd marks the unit failed and we get
# operator-visible alerts via journal.
_FETCH_TOLERATED = (
    httpx.TimeoutException,
    httpx.ConnectError,
    httpx.ReadError,
    httpx.RemoteProtocolError,
)


async def _upsert_weather(db: AsyncSession, row: dict) -> None:
    stmt = pg_insert(WeatherObservation).values([row])
    update_cols = {
        c.name: stmt.excluded[c.name]
        for c in WeatherObservation.__table__.columns
        if c.name not in {"id", "fetched_at", "site_id", "observed_at", "data_version"}
    }
    await db.execute(stmt.on_conflict_do_update(
        index_elements=["site_id", "observed_at", "data_version"],
        set_=update_cols,
    ))


async def run_once() -> int:
    """Fetch latest AMeDAS for every site with jma_station_id.

    Returns the count of rows written. Always writes an audit row capturing
    successes and per-bucket failure counts so a silently-failing run is
    distinguishable from a "no sites" run.
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
            select(Site).where(Site.jma_station_id.isnot(None))
        )).scalars().all()

        if not sites:
            log.info("no sites with jma_station_id; nothing to fetch")
            return 0

        async with httpx.AsyncClient(
            headers={"User-Agent": settings.jma_user_agent}
        ) as client:
            for site in sites:
                station = site.jma_station_id
                try:
                    result = await jma_svc.fetch_latest(client, station)
                except httpx.HTTPStatusError as exc:
                    # 4xx (not 404) and 5xx surface here — these are operator-
                    # visible upstream signals: UA banned, rate-limited, outage.
                    code = exc.response.status_code
                    if 400 <= code < 500:
                        upstream_4xx += 1
                    elif 500 <= code < 600:
                        upstream_5xx += 1
                    log.error("jma upstream %s site=%s station=%s url=%s",
                              code, site.code, station, exc.request.url)
                    fetch_failed += 1
                    continue
                except _FETCH_TOLERATED as exc:
                    log.warning("jma transient site=%s station=%s: %s",
                                site.code, station, exc)
                    fetch_failed += 1
                    continue
                # Other exceptions (programming bug, schema drift, OOM…) propagate.

                if not result:
                    log.info("no data site=%s station=%s", site.code, station)
                    no_data += 1
                    continue

                observed_at, entry = result
                row = jma_svc.normalise(entry, observed_at, str(site.id),
                                        station_id=station)
                # Per-row SAVEPOINT: if the upsert fails (e.g. CHECK constraint),
                # the outer transaction stays usable so the next site still works.
                try:
                    async with db.begin_nested():
                        await _upsert_weather(db, row)
                    written += 1
                except SQLAlchemyError as exc:
                    log.warning("upsert failed site=%s: %s", site.code, exc)
                    upsert_failed += 1
                    continue

            # Always audit — successes AND failures — so a silently-failing
            # ingester is visible in the audit_log.
            try:
                await write_audit(
                    db, actor="jma_fetcher", action="observation.weather.ingest",
                    target_type="weather_observation", target_id=None,
                    detail={
                        "written": written,
                        "fetch_failed": fetch_failed,
                        "upsert_failed": upsert_failed,
                        "no_data": no_data,
                        "upstream_4xx": upstream_4xx,
                        "upstream_5xx": upstream_5xx,
                        "sites_total": len(sites),
                        "source": "jma_amedas",
                    },
                )
                await db.commit()
            except SQLAlchemyError as exc:
                log.error("ingest audit/commit failed: %s", exc)
                await db.rollback()
                raise

    log.info(
        "ingest_jma: wrote=%d fetch_failed=%d (4xx=%d 5xx=%d) "
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
        log.error("ingest_jma crashed: %s", exc, exc_info=True)
        return 1
    return 0 if n >= 0 else 1


if __name__ == "__main__":
    sys.exit(main())
