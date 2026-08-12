"""Periodic job: fetch NOWPHAS real-time marine observations (public data).

NOWPHAS（国土交通省 全国港湾海洋波浪情報網）は公的一次情報であり、
JMA 波浪ナウキャストの提供方式変更（2026 年時点で従来 URL が 404）に伴う
海象データ源の正として利用する。`source="nowphas"` で保存されるため、
判定 API は Open-Meteo（参考情報）と異なり NOWPHAS を施工判断入力として扱う。

Invoked by systemd timer or manually:

    python -m app.jobs.ingest_nowphas

Idempotent: relies on (site_id, observed_at, data_version) ON CONFLICT upsert.
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
from app.services import nowphas as nowphas_svc
from app.services.audit import write_audit

log = logging.getLogger("wmcdss.jobs.ingest_nowphas")

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
    """NOWPHAS 実況を全 marine/both 現場へ最近傍局ベースで取り込む。"""
    settings = get_settings()
    written = 0
    matched = 0
    no_station = 0
    no_sample = 0
    upsert_failed = 0

    async with SessionLocal() as db:
        sites = (await db.execute(
            select(Site).where(Site.kind.in_(["marine", "both"]))
        )).scalars().all()

        if not sites:
            log.info("no marine/both sites; nothing to fetch")
            try:
                await write_audit(
                    db, actor="nowphas_fetcher", action="observation.marine.ingest",
                    target_type="marine_observation", target_id=None,
                    detail={"sites_total": 0, "source": nowphas_svc.SOURCE},
                )
                await db.commit()
            except SQLAlchemyError as exc:
                log.error("nowphas audit/commit failed: %s", exc)
                await db.rollback()
                raise
            return 0

        stations: list = []
        samples: dict = {}
        fetch_failed = 0
        async with httpx.AsyncClient(
            headers={"User-Agent": settings.jma_user_agent}
        ) as client:
            try:
                stations = await nowphas_svc.fetch_stations(client)
                _, samples = await nowphas_svc.fetch_latest(client)
            except httpx.HTTPStatusError as exc:
                log.error("nowphas upstream HTTP %s: %s", exc.response.status_code, exc.request.url)
                fetch_failed += 1
            except _FETCH_TOLERATED as exc:
                log.warning("nowphas upstream transient: %s", exc)
                fetch_failed += 1

        if fetch_failed:
            try:
                await write_audit(
                    db, actor="nowphas_fetcher", action="observation.marine.ingest",
                    target_type="marine_observation", target_id=None,
                    detail={
                        "written": 0,
                        "fetch_failed": fetch_failed,
                        "sites_total": len(sites),
                        "source": nowphas_svc.SOURCE,
                        "usage": "decision_evidence_public_data",
                    },
                )
                await db.commit()
            except SQLAlchemyError as exc:
                log.error("nowphas audit/commit failed: %s", exc)
                await db.rollback()
                raise
            return 0

        for site in sites:
            st = nowphas_svc.nearest_station(stations, site.lat, site.lon)
            sample = samples.get(st.code) if st else None
            if st is None:
                no_station += 1
                continue
            if sample is None or sample.observed_at is None:
                no_sample += 1
                continue
            matched += 1
            row = nowphas_svc.normalise(
                sample, str(site.id), station_code=st.code,
            )
            try:
                async with db.begin_nested():
                    await _upsert_marine(db, row)
                written += 1
            except SQLAlchemyError as exc:
                log.warning("nowphas upsert failed site=%s station=%s: %s",
                            site.code, st.code, exc)
                upsert_failed += 1
                continue

        try:
            await write_audit(
                db, actor="nowphas_fetcher", action="observation.marine.ingest",
                target_type="marine_observation", target_id=None,
                detail={
                    "written": written,
                    "matched": matched,
                    "no_station": no_station,
                    "no_sample": no_sample,
                    "upsert_failed": upsert_failed,
                    "sites_total": len(sites),
                    "stations_total": len(stations),
                    "samples_total": len(samples),
                    "fetch_failed": 0,
                    "source": nowphas_svc.SOURCE,
                    "usage": "decision_evidence_public_data",
                },
            )
            await db.commit()
        except SQLAlchemyError as exc:
            log.error("nowphas audit/commit failed: %s", exc)
            await db.rollback()
            raise

    log.info(
        "ingest_nowphas: wrote=%d matched=%d no_station=%d no_sample=%d upsert_failed=%d",
        written, matched, no_station, no_sample, upsert_failed,
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
        log.error("ingest_nowphas crashed: %s", exc, exc_info=True)
        return 1
    return 0 if n >= 0 else 1


if __name__ == "__main__":
    sys.exit(main())
