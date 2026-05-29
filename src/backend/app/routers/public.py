"""Public endpoints: site settings and carousel (no auth required)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import SiteSetting, Carousel

router = APIRouter(prefix="/api/public", tags=["public"])

# Keys the frontend is allowed to read via the public endpoint.
_PUBLIC_SETTING_KEYS = {
    "site_name",
    "site_title",
    "site_logo",
    "site_subtitle",
    "allow_register",
    "require_invite",
    "register_email_suffixes",
    "enable_skin_library",
    "email_verify_enabled",
    "footer_text",
    "filing_icp",
    "filing_icp_link",
    "filing_mps",
    "filing_mps_link",
    "home_image_urls",
}


@router.get("/settings")
async def get_public_settings(db: AsyncSession = Depends(get_db)) -> dict:
    rows = (
        await db.execute(select(SiteSetting).where(SiteSetting.key.in_(_PUBLIC_SETTING_KEYS)))
    ).scalars().all()
    return {s.key: s.value for s in rows}


@router.get("/carousel")
async def get_carousel(db: AsyncSession = Depends(get_db)) -> list[dict]:
    rows = (
        await db.execute(select(Carousel).order_by(Carousel.sort_order, Carousel.id))
    ).scalars().all()
    return [
        {
            "id": c.id,
            "title": c.title,
            "image_url": c.image_url,
            "link_url": c.link_url,
            "description": c.description,
            "sort_order": c.sort_order,
        }
        for c in rows
    ]
