"""Public endpoints: default avatar (no auth required).

Note: /api/public/settings, /api/public/carousel, /api/public/skin-library,
and /api/public/default-avatar are now served from site_routes.py
which provides the full vSkin-compatible implementations.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/public", tags=["public"])

# All public endpoints have been migrated to site_routes.py
# which provides the vSkin-compatible implementations with
# proper fallback service URLs and normalized settings.
