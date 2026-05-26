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
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.observations import WeatherObservation
from app.models.site import Site
from app.services import jma as jma_svc
from app.services.audit import write_audit

log = logging.getLogger("wmcdss.jobs.ingest_jma")


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
    """Fetch latest AMeDAS for every site with jma_station_id. Return count."""
    settings = get_settings()
    written = 0
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
                except Exception as exc:
                    log.warning("fetch failed site=%s station=%s: %s",
                                site.code, station, exc)
                    continue
                if not result:
                    log.info("no data site=%s station=%s", site.code, station)
                    continue
                observed_at, entry = result
                row = jma_svc.normalise(entry, observed_at, str(site.id))
                try:
                    await _upsert_weather(db, row)
                    written += 1
                except Exception as exc:
                    log.warning("upsert failed site=%s: %s", site.code, exc)
                    continue

            if written:
                await write_audit(
                    db, actor="jma_fetcher", action="observation.weather.ingest",
                    target_type="weather_observation", target_id=None,
                    detail={"count": written, "source": "jma_amedas"},
                )
                await db.commit()

    log.info("ingest_jma: wrote %d observation(s)", written)
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
