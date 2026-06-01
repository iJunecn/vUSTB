"""动态 / 文章发布系统 API。

公开路由：文章列表、文章详情、分类列表
管理员路由：文章 CRUD、分类 CRUD、媒体上传
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.deps import get_current_admin, get_current_user
from app.models import User
from app.models.article import Article, ArticleCategory, ArticleMedia

# ========== 公开路由 ==========
public_router = APIRouter(prefix="/api/articles", tags=["articles-public"])
admin_router = APIRouter(prefix="/api/admin/articles", tags=["articles-admin"])


# --------------- Pydantic Schemas ---------------

class CategoryOut(BaseModel):
    id: int
    name: str
    description: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

class CategoryCreate(BaseModel):
    name: str = Field(..., max_length=128)
    description: str | None = None

class CategoryUpdate(BaseModel):
    name: str | None = Field(None, max_length=128)
    description: str | None = None

class ArticleListOut(BaseModel):
    id: int
    title: str
    summary: str | None = None
    category_id: int | None = None
    category: CategoryOut | None = None
    author_id: int | None = None
    view_count: int = 0
    cover_image_url: str | None = None
    cover_image_alt: str | None = None
    is_pinned: bool = False
    pin_order: int = 0
    seo_title: str | None = None
    seo_description: str | None = None
    seo_keywords: str | None = None
    seo_slug: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

class ArticleDetailOut(ArticleListOut):
    content: str = ""
    content_type: str = "markdown"
    pinned_at: datetime | None = None

class ArticleCreate(BaseModel):
    title: str = Field(..., max_length=255)
    content: str
    content_type: str = "markdown"
    summary: str | None = None
    category_id: int | None = None
    cover_image_url: str | None = None
    cover_image_alt: str | None = None
    is_pinned: bool = False
    pin_order: int = 0
    seo_title: str | None = None
    seo_description: str | None = None
    seo_keywords: str | None = None
    seo_slug: str | None = None

class ArticleUpdate(BaseModel):
    title: str | None = Field(None, max_length=255)
    content: str | None = None
    content_type: str | None = None
    summary: str | None = None
    category_id: int | None = None
    cover_image_url: str | None = None
    cover_image_alt: str | None = None
    is_pinned: bool | None = None
    pin_order: int | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    seo_keywords: str | None = None
    seo_slug: str | None = None


# --------------- Helper ---------------

def _article_to_list_out(a: Article) -> ArticleListOut:
    cat = CategoryOut(id=a.category.id, name=a.category.name, description=a.category.description,
                      created_at=a.category.created_at, updated_at=a.category.updated_at) if a.category else None
    return ArticleListOut(
        id=a.id, title=a.title, summary=a.summary,
        category_id=a.category_id, category=cat,
        author_id=a.author_id, view_count=a.view_count,
        cover_image_url=a.cover_image_url, cover_image_alt=a.cover_image_alt,
        is_pinned=a.is_pinned, pin_order=a.pin_order,
        seo_title=a.seo_title, seo_description=a.seo_description,
        seo_keywords=a.seo_keywords, seo_slug=a.seo_slug,
        created_at=a.created_at, updated_at=a.updated_at,
    )


def _article_to_detail_out(a: Article) -> ArticleDetailOut:
    cat = CategoryOut(id=a.category.id, name=a.category.name, description=a.category.description,
                      created_at=a.category.created_at, updated_at=a.category.updated_at) if a.category else None
    return ArticleDetailOut(
        id=a.id, title=a.title, content=a.content, content_type=a.content_type,
        summary=a.summary, category_id=a.category_id, category=cat,
        author_id=a.author_id, view_count=a.view_count,
        cover_image_url=a.cover_image_url, cover_image_alt=a.cover_image_alt,
        is_pinned=a.is_pinned, pin_order=a.pin_order, pinned_at=a.pinned_at,
        seo_title=a.seo_title, seo_description=a.seo_description,
        seo_keywords=a.seo_keywords, seo_slug=a.seo_slug,
        created_at=a.created_at, updated_at=a.updated_at,
    )


# ============ 公开 API ============

@public_router.get("", response_model=list[ArticleListOut])
async def list_articles(
    category_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """公开：获取文章列表（不含正文，用于列表页）。"""
    q = select(Article).options(selectinload(Article.category)).where(
        Article.created_at <= datetime.now(timezone.utc)
    )
    if category_id is not None:
        q = q.where(Article.category_id == category_id)
    q = q.order_by(Article.is_pinned.desc(), Article.pin_order.asc(), Article.created_at.desc())
    q = q.offset((page - 1) * limit).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return [_article_to_list_out(a) for a in rows]


@public_router.get("/categories", response_model=list[CategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db)):
    """公开：获取所有分类。"""
    rows = (await db.execute(
        select(ArticleCategory).order_by(ArticleCategory.id)
    )).scalars().all()
    return [CategoryOut(id=c.id, name=c.name, description=c.description,
                        created_at=c.created_at, updated_at=c.updated_at) for c in rows]


@public_router.get("/search", response_model=list[ArticleListOut])
async def search_articles(
    q: str = Query("", max_length=200),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """公开：搜索文章。"""
    query = select(Article).options(selectinload(Article.category)).where(
        Article.created_at <= datetime.now(timezone.utc)
    )
    if q:
        pattern = f"%{q}%"
        query = query.where(
            (Article.title.ilike(pattern)) |
            (Article.summary.ilike(pattern)) |
            (Article.seo_keywords.ilike(pattern))
        )
    query = query.order_by(Article.is_pinned.desc(), Article.pin_order.asc(), Article.created_at.desc())
    query = query.offset((page - 1) * limit).limit(limit)
    rows = (await db.execute(query)).scalars().all()
    return [_article_to_list_out(a) for a in rows]


@public_router.get("/count")
async def count_articles(db: AsyncSession = Depends(get_db)):
    """公开：文章总数。"""
    cnt = (await db.execute(
        select(func.count(Article.id)).where(Article.created_at <= datetime.now(timezone.utc))
    )).scalar() or 0
    return {"count": cnt}


@public_router.get("/{article_id}", response_model=ArticleDetailOut)
async def get_article(
    article_id: int | str,
    db: AsyncSession = Depends(get_db),
):
    """公开：获取文章详情（含正文），支持数字 ID 或 seo_slug 查询。"""
    q = select(Article).options(selectinload(Article.category))
    try:
        numeric_id = int(article_id)
        q = q.where(Article.id == numeric_id)
    except (ValueError, TypeError):
        q = q.where(Article.seo_slug == article_id)

    article = (await db.execute(q)).scalar_one_or_none()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    if article.created_at and article.created_at > datetime.now(timezone.utc):
        raise HTTPException(status_code=404, detail="文章不存在")

    # 增加浏览量
    article.view_count = (article.view_count or 0) + 1
    await db.commit()
    await db.refresh(article)

    return _article_to_detail_out(article)


# ============ 管理 API ============

@admin_router.get("", response_model=list[ArticleDetailOut])
async def admin_list_articles(
    category_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """管理：获取所有文章（含定时发布）。"""
    q = select(Article).options(selectinload(Article.category))
    if category_id is not None:
        q = q.where(Article.category_id == category_id)
    q = q.order_by(Article.is_pinned.desc(), Article.pin_order.asc(), Article.created_at.desc())
    q = q.offset((page - 1) * limit).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return [_article_to_detail_out(a) for a in rows]


@admin_router.get("/count")
async def admin_count_articles(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """管理：文章总数（含定时发布）。"""
    cnt = (await db.execute(select(func.count(Article.id)))).scalar() or 0
    return {"count": cnt}


@admin_router.post("", response_model=ArticleDetailOut, status_code=201)
async def create_article(
    body: ArticleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    """管理：创建文章。"""
    # 检查 seo_slug 唯一性
    if body.seo_slug:
        existing = (await db.execute(
            select(Article).where(Article.seo_slug == body.seo_slug)
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail="SEO slug 已被使用")

    # 检查置顶数量上限
    if body.is_pinned:
        pinned_count = (await db.execute(
            select(func.count(Article.id)).where(Article.is_pinned == True)
        )).scalar() or 0
        if pinned_count >= 2:
            raise HTTPException(status_code=400, detail="最多只能置顶 2 篇文章")

    article = Article(
        title=body.title,
        content=body.content,
        content_type=body.content_type,
        summary=body.summary,
        category_id=body.category_id,
        author_id=user.id,
        cover_image_url=body.cover_image_url,
        cover_image_alt=body.cover_image_alt,
        is_pinned=body.is_pinned,
        pin_order=body.pin_order if body.is_pinned else 0,
        pinned_at=datetime.now(timezone.utc) if body.is_pinned else None,
        seo_title=body.seo_title,
        seo_description=body.seo_description,
        seo_keywords=body.seo_keywords,
        seo_slug=body.seo_slug,
    )
    db.add(article)
    await db.commit()
    await db.refresh(article)
    # reload with category
    article = (await db.execute(
        select(Article).options(selectinload(Article.category)).where(Article.id == article.id)
    )).scalar_one()
    return _article_to_detail_out(article)


@admin_router.get("/{article_id}", response_model=ArticleDetailOut)
async def admin_get_article(
    article_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """管理：获取文章详情（含定时发布）。"""
    article = (await db.execute(
        select(Article).options(selectinload(Article.category)).where(Article.id == article_id)
    )).scalar_one_or_none()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    return _article_to_detail_out(article)


@admin_router.put("/{article_id}", response_model=ArticleDetailOut)
async def update_article(
    article_id: int,
    body: ArticleUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """管理：更新文章。"""
    article = (await db.execute(
        select(Article).options(selectinload(Article.category)).where(Article.id == article_id)
    )).scalar_one_or_none()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")

    update_data = body.model_dump(exclude_unset=True)

    # 检查 seo_slug 唯一性
    if "seo_slug" in update_data and update_data["seo_slug"] and update_data["seo_slug"] != article.seo_slug:
        existing = (await db.execute(
            select(Article).where(Article.seo_slug == update_data["seo_slug"], Article.id != article_id)
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail="SEO slug 已被使用")

    # 处理置顶逻辑
    if "is_pinned" in update_data:
        new_pinned = update_data["is_pinned"]
        if new_pinned and not article.is_pinned:
            pinned_count = (await db.execute(
                select(func.count(Article.id)).where(Article.is_pinned == True, Article.id != article_id)
            )).scalar() or 0
            if pinned_count >= 2:
                raise HTTPException(status_code=400, detail="最多只能置顶 2 篇文章")
            update_data["pinned_at"] = datetime.now(timezone.utc)
            if "pin_order" not in update_data:
                update_data["pin_order"] = 1
        elif not new_pinned:
            update_data["pinned_at"] = None
            update_data["pin_order"] = 0

    for k, v in update_data.items():
        setattr(article, k, v)

    await db.commit()
    await db.refresh(article)
    return _article_to_detail_out(article)


@admin_router.delete("/{article_id}")
async def delete_article(
    article_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """管理：删除文章。"""
    article = (await db.execute(
        select(Article).where(Article.id == article_id)
    )).scalar_one_or_none()
    if not article:
        raise HTTPException(status_code=404, detail="文章不存在")
    await db.delete(article)
    await db.commit()
    return {"ok": True}


# ============ 分类管理 API ============

cat_admin_router = APIRouter(prefix="/api/admin/article-categories", tags=["article-categories-admin"])


@cat_admin_router.get("", response_model=list[CategoryOut])
async def admin_list_categories(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    rows = (await db.execute(
        select(ArticleCategory).order_by(ArticleCategory.id)
    )).scalars().all()
    return [CategoryOut(id=c.id, name=c.name, description=c.description,
                        created_at=c.created_at, updated_at=c.updated_at) for c in rows]


@cat_admin_router.post("", response_model=CategoryOut, status_code=201)
async def admin_create_category(
    body: CategoryCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    existing = (await db.execute(
        select(ArticleCategory).where(ArticleCategory.name == body.name)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="分类名称已存在")
    cat = ArticleCategory(name=body.name, description=body.description)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return CategoryOut(id=cat.id, name=cat.name, description=cat.description,
                      created_at=cat.created_at, updated_at=cat.updated_at)


@cat_admin_router.put("/{cat_id}", response_model=CategoryOut)
async def admin_update_category(
    cat_id: int,
    body: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    cat = (await db.execute(
        select(ArticleCategory).where(ArticleCategory.id == cat_id)
    )).scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    if body.name is not None:
        # 检查名称唯一性
        dup = (await db.execute(
            select(ArticleCategory).where(ArticleCategory.name == body.name, ArticleCategory.id != cat_id)
        )).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="分类名称已存在")
        cat.name = body.name
    if body.description is not None:
        cat.description = body.description
    await db.commit()
    await db.refresh(cat)
    return CategoryOut(id=cat.id, name=cat.name, description=cat.description,
                      created_at=cat.created_at, updated_at=cat.updated_at)


@cat_admin_router.delete("/{cat_id}")
async def admin_delete_category(
    cat_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    cat = (await db.execute(
        select(ArticleCategory).where(ArticleCategory.id == cat_id)
    )).scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    # 检查是否有文章使用该分类
    article_count = (await db.execute(
        select(func.count(Article.id)).where(Article.category_id == cat_id)
    )).scalar() or 0
    if article_count > 0:
        raise HTTPException(status_code=400, detail=f"该分类下有 {article_count} 篇文章，无法删除")
    await db.delete(cat)
    await db.commit()
    return {"ok": True}


# ============ 媒体上传 API ============

media_router = APIRouter(prefix="/api/admin/article-media", tags=["article-media-admin"])


class MediaOut(BaseModel):
    id: int
    file_name: str
    original_name: str
    url: str
    alt: str | None = None
    mime_type: str
    file_size: int
    created_at: datetime | None = None


@media_router.get("", response_model=list[MediaOut])
async def list_media(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    rows = (await db.execute(
        select(ArticleMedia).order_by(ArticleMedia.created_at.desc())
    )).scalars().all()
    return [MediaOut(id=m.id, file_name=m.file_name, original_name=m.original_name,
                     url=m.url, alt=m.alt, mime_type=m.mime_type, file_size=m.file_size,
                     created_at=m.created_at) for m in rows]


@media_router.post("/upload", response_model=MediaOut)
async def upload_media(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_admin),
):
    """上传文章媒体文件。"""
    allowed_types = {"image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp", "video/mp4"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="不支持的文件类型")

    ext_map = {
        "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
        "image/svg+xml": ".svg", "image/webp": ".webp", "video/mp4": ".mp4",
    }
    ext = ext_map.get(file.content_type, ".bin")

    upload_dir = os.path.join(settings.carousel_directory, "..", "article_media")
    upload_dir = os.path.normpath(upload_dir)
    os.makedirs(upload_dir, exist_ok=True)

    filename = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(upload_dir, filename)

    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)

    url = f"/static/article_media/{filename}"

    media = ArticleMedia(
        file_name=filename,
        original_name=file.filename or filename,
        file_path=dest,
        file_size=len(content),
        mime_type=file.content_type,
        url=url,
        uploader_id=user.id,
    )
    db.add(media)
    await db.commit()
    await db.refresh(media)

    return MediaOut(id=media.id, file_name=media.file_name, original_name=media.original_name,
                   url=media.url, alt=media.alt, mime_type=media.mime_type,
                   file_size=media.file_size, created_at=media.created_at)


@media_router.delete("/{media_id}")
async def delete_media(
    media_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    media = (await db.execute(
        select(ArticleMedia).where(ArticleMedia.id == media_id)
    )).scalar_one_or_none()
    if not media:
        raise HTTPException(status_code=404, detail="媒体不存在")
    # 删除文件
    if os.path.exists(media.file_path):
        os.remove(media.file_path)
    await db.delete(media)
    await db.commit()
    return {"ok": True}
