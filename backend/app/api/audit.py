"""Audit-log read API. Write is internal via app.services.audit.

認証: JWT を要求する (``Depends(get_current_user)``)。

監査ログは `actor`（ユーザー名。M365 認証ではメールアドレス由来）と、誰が何を
いつ操作したかの全履歴を保持する。API キー middleware は
`auth_required_methods` (既定 POST,PATCH,PUT,DELETE) しか守らないため、GET で
あるこのエンドポイントは middleware 側では一切保護されない。route 側で
明示的に JWT を要求しないと、backend に到達できる者が監査証跡と利用者名簿を
そのまま読み出せる。
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import UserInfo, require_admin_jwt
from app.db.session import get_db
from app.models.audit import AuditLog
from app.schemas.audit import AuditOut

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=list[AuditOut])
async def list_audit(
    actor: str | None = Query(default=None),
    action: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    target_id: str | None = Query(default=None),
    t0: datetime | None = Query(default=None),
    t1: datetime | None = Query(default=None),
    limit: int = Query(default=200, le=1000),
    # 認証を DB より先に宣言する。FastAPI は依存を宣言順に解決するため、
    # この順序だと未認証リクエストは DB セッションを取得せずに 401 で終わる。
    # 逆順にすると、認証されないアクセスでもコネクションプールを消費できる。
    _current_user: UserInfo = Depends(require_admin_jwt),
    db: AsyncSession = Depends(get_db),
):
    t1 = t1 or datetime.now(timezone.utc)
    t0 = t0 or (t1 - timedelta(days=7))
    stmt = select(AuditLog).where(AuditLog.occurred_at.between(t0, t1))
    if actor:
        stmt = stmt.where(AuditLog.actor == actor)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if target_type:
        stmt = stmt.where(AuditLog.target_type == target_type)
    if target_id:
        stmt = stmt.where(AuditLog.target_id == target_id)
    stmt = stmt.order_by(AuditLog.occurred_at.desc()).limit(limit)
    return (await db.execute(stmt)).scalars().all()
