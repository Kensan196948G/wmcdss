"""Audit-log helper.

Keep audit writes off the request-critical path: callers `await write_audit(...)`
but failures must not propagate (logged warn). The audit is best-effort durability,
not a transactional invariant — payments-grade auditing would use outbox pattern.
"""
from __future__ import annotations
import logging
from typing import Any

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog

log = logging.getLogger(__name__)


async def write_audit(
    db: AsyncSession,
    *,
    actor: str | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    detail: dict[str, Any] | None = None,
    strict: bool = False,
) -> None:
    """Audit write with selectable durability.

    Default (`strict=False`): best-effort. DB errors are swallowed and logged
    at ERROR so journal/Sentry catches sustained outages. Used for high-volume
    ingest where losing an audit row is preferable to dropping the request.

    `strict=True`: business-critical mutations (site/decision/threshold CRUD).
    Re-raises `SQLAlchemyError` so the caller's `db.commit()` never runs and
    the surrounding transaction rolls back — audit failure makes the business
    write fail too. This is the atomic contract the API smoke tests pin.

    Programming errors — e.g. an `AttributeError` from a typo'd kwarg or a
    `TypeError` from wrong-shaped `detail` — always propagate so tests and
    dev catch them.
    """
    try:
        row = AuditLog(
            actor=actor, action=action,
            target_type=target_type, target_id=target_id,
            detail=detail,
        )
        db.add(row)
        await db.flush()
    except SQLAlchemyError as exc:
        log.error("audit write failed action=%s target=%s/%s strict=%s: %s",
                  action, target_type, target_id, strict, exc)
        if strict:
            raise
