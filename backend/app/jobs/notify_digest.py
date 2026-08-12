"""Periodic job: 直近 24 時間の「警戒・中止」判定ダイジェストを通知する。

判定は既に DB に保存済み（監査対象）。本ジョブは通知だけを行うため、
通知経路が未設定・失敗しても業務データには影響しない。

    python -m app.jobs.notify_digest
"""
from __future__ import annotations
import asyncio
import logging
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import SessionLocal
from app.models.decision import Decision
from app.models.site import Site
from app.services.audit import write_audit
from app.services import notify

log = logging.getLogger("wmcdss.jobs.notify_digest")


def build_digest(
    rows: list[tuple[str, str, str, str]],
) -> str:
    """(site_code, site_name, work_type, status) の行から日本語ダイジェスト文を作る。"""
    if not rows:
        return ""
    by_site: dict[str, list[str]] = defaultdict(list)
    labels = {"stop": "中止推奨", "caution": "注意"}
    for site_code, site_name, work_type, status in rows:
        by_site[f"{site_code} {site_name}"].append(
            f"{work_type}: {labels.get(status, status)}"
        )
    lines = ["【WMCDSS】直近24時間の施工判定サマリー", ""]
    for site in sorted(by_site):
        lines.append(f"■ {site}")
        lines.extend(f"  - {item}" for item in by_site[site])
    lines.append("")
    lines.append("最終判定は現場責任者が行ってください。本通知は自動生成です。")
    return "\n".join(lines)


async def run_once() -> int:
    """通知対象判定が 1 件以上あればダイジェストを送信する。送信成功数を返す。"""
    now = datetime.now(timezone.utc)
    t0 = now - timedelta(hours=24)

    async with SessionLocal() as db:
        stmt = (
            select(Site.code, Site.name, Decision.work_type, Decision.status)
            .join(Decision, Decision.site_id == Site.id)
            .where(Decision.status.in_(["stop", "caution"]))
            .where(Decision.generated_at >= t0)
        )
        rows = [
            (code, name, work_type, status)
            for code, name, work_type, status in (await db.execute(stmt)).all()
        ]
        body = build_digest(rows)
        sent = 0
        if body:
            sent = await notify.notify("WMCDSS 施工判定サマリー（24時間）", body)
        try:
            await write_audit(
                db, actor="notify_digest", action="notification.digest",
                target_type=None, target_id=None,
                detail={
                    "decisions": len(rows),
                    "sent": sent,
                    "notify_configured": notify.is_configured(),
                    "window_hours": 24,
                },
            )
            await db.commit()
        except SQLAlchemyError as exc:
            log.error("notify_digest audit/commit failed: %s", exc)
            await db.rollback()
            raise
    log.info("notify_digest: decisions=%d sent=%d", len(rows), sent)
    return sent


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    try:
        asyncio.run(run_once())
    except Exception as exc:  # noqa: BLE001
        log.error("notify_digest crashed: %s", exc, exc_info=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
