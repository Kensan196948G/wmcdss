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
) -> None:
    """Best-effort audit write.

    Only DB errors are swallowed (logged at ERROR so journal/Sentry catches a
    sustained outage). Programming errors — e.g. an `AttributeError` from a
    typo'd kwarg or a `TypeError` from wrong-shaped `detail` — propagate so
    tests and dev catch them.
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
        log.error("audit write failed action=%s target=%s/%s: %s",
                  action, target_type, target_id, exc)
