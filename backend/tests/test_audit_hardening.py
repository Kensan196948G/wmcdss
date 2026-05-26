"""Pin the audit-hardening contracts that block credential leak + silent failure.

These cover two CRITICAL findings from cross-validated review:
1. `actor_from` MUST NOT fall back to `X-API-Key`'s value (the audit table is
   readable unauthenticated, so leaking the key into `actor` would be game-over).
2. `write_audit(strict=True)` MUST re-raise `SQLAlchemyError` so the surrounding
   business commit is skipped — the API smoke layer guarantees "every business
   mutation is either fully recorded in audit or not persisted at all".
"""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.exc import SQLAlchemyError
from starlette.datastructures import Headers
from starlette.requests import Request

from app.core.security import actor_from
from app.services.audit import write_audit


def _req(headers: dict[str, str]) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/x",
        "headers": Headers(headers).raw,
    }
    return Request(scope)


class TestActorFrom:
    def test_x_actor_used_when_present(self):
        assert actor_from(_req({"X-Actor": "alice"})) == "alice"

    def test_falls_back_to_anonymous_without_x_actor(self):
        assert actor_from(_req({})) == "anonymous"

    def test_does_not_leak_api_key(self):
        """Regression: previous _actor() returned the API key itself when no
        X-Actor was set. /api/v1/audit is unauthenticated; that was a leak."""
        secret = "super-secret-api-key"
        assert actor_from(_req({"X-API-Key": secret})) == "anonymous"
        assert actor_from(_req({"X-API-Key": secret})) != secret

    def test_x_actor_wins_over_x_api_key(self):
        assert actor_from(_req({"X-Actor": "alice", "X-API-Key": "k"})) == "alice"

    def test_empty_x_actor_treated_as_missing(self):
        assert actor_from(_req({"X-Actor": "   "})) == "anonymous"

    def test_x_actor_truncated_to_cap(self):
        long = "a" * 200
        result = actor_from(_req({"X-Actor": long}))
        assert len(result) == 64


class TestWriteAuditStrict:
    @pytest.mark.asyncio
    async def test_default_swallows_db_errors(self):
        """Best-effort mode keeps the request path resilient."""
        db = MagicMock()
        db.add = MagicMock()
        db.flush = AsyncMock(side_effect=SQLAlchemyError("boom"))
        # Must NOT raise
        await write_audit(db, actor="x", action="observation.weather.ingest")

    @pytest.mark.asyncio
    async def test_strict_reraises_db_errors(self):
        """Business-critical mode propagates so caller's commit is skipped."""
        db = MagicMock()
        db.add = MagicMock()
        db.flush = AsyncMock(side_effect=SQLAlchemyError("boom"))
        with pytest.raises(SQLAlchemyError):
            await write_audit(db, actor="x", action="site.create", strict=True)

    @pytest.mark.asyncio
    async def test_programming_errors_always_propagate(self):
        """Typo'd kwargs / shape errors must surface in dev regardless of mode."""
        db = MagicMock()
        db.add = MagicMock(side_effect=TypeError("bad detail"))
        db.flush = AsyncMock()
        with pytest.raises(TypeError):
            await write_audit(db, actor="x", action="site.create")
        with pytest.raises(TypeError):
            await write_audit(db, actor="x", action="site.create", strict=True)
