from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import UserInfo, get_current_user_or_anon, require_admin_or_api_key
from app.core.security import actor_from
from app.db.session import get_db
from app.models.site import Site
from app.schemas.site import SiteCreate, SiteOut
from app.services.audit import write_audit

router = APIRouter(prefix="/sites", tags=["sites"])


@router.get("", response_model=list[SiteOut])
async def list_sites(
    _current_user: UserInfo = Depends(get_current_user_or_anon),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(select(Site).order_by(Site.code))).scalars().all()
    return rows


@router.post("", response_model=SiteOut, status_code=201)
async def create_site(
    payload: SiteCreate,
    request: Request,
    _admin: UserInfo = Depends(require_admin_or_api_key),
    db: AsyncSession = Depends(get_db),
):
    if (await db.execute(select(Site).where(Site.code == payload.code))).scalar_one_or_none():
        raise HTTPException(409, f"site code {payload.code!r} already exists")
    site = Site(**payload.model_dump())
    db.add(site)
    await db.flush()
    await write_audit(
        db, actor=actor_from(request), action="site.create",
        target_type="site", target_id=str(site.id),
        detail=payload.model_dump(mode="json"),
        strict=True,
    )
    await db.commit()
    await db.refresh(site)
    return site


@router.get("/{site_id}", response_model=SiteOut)
async def get_site(
    site_id: str,
    _current_user: UserInfo = Depends(get_current_user_or_anon),
    db: AsyncSession = Depends(get_db),
):
    site = (await db.execute(select(Site).where(Site.id == site_id))).scalar_one_or_none()
    if not site:
        raise HTTPException(404, "site not found")
    return site
