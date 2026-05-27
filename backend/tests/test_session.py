"""Unit tests for app.db.session — get_db() generator coverage."""
from __future__ import annotations
from unittest.mock import AsyncMock, patch

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db


async def test_get_db_yields_session():
    # get_db() is an async generator used via FastAPI dependency injection.
    # All API tests skip it via dependency_overrides, leaving lines 12-13
    # (the async with + yield) uncovered. Drive it directly here.
    mock_session = AsyncMock(spec=AsyncSession)
    mock_cm = AsyncMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("app.db.session.SessionLocal", return_value=mock_cm):
        gen = get_db()
        session = await gen.__anext__()

    assert session is mock_session
