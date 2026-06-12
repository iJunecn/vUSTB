"""动态 / 文章发布系统模型。

移植自 kuno-main 项目，简化移除 i18n 翻译、AI 分析等复杂功能，
保留核心的文章发布、分类、置顶、封面图等功能。
"""

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import String, Integer, Boolean, DateTime, Text, ForeignKey, func, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ArticleStatus(str, PyEnum):
    """文章状态：草稿 / 已发布。"""
    draft = "draft"
    published = "published"


class ArticleCategory(Base):
    """文章分类。"""
    __tablename__ = "article_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, comment="分类名称")
    description: Mapped[str | None] = mapped_column(Text, nullable=True, comment="分类描述")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # relationships
    articles: Mapped[list["Article"]] = relationship(
        "Article", back_populates="category", lazy="selectin"
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class Article(Base):
    """文章 / 动态。"""
    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, comment="标题")
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="内容 (markdown)")
    status: Mapped[str] = mapped_column(
        SAEnum(ArticleStatus, name="article_status", create_constraint=False),
        default=ArticleStatus.published, server_default="published",
        nullable=False, comment="文章状态: draft / published"
    )
    content_type: Mapped[str] = mapped_column(
        String(20), default="markdown", server_default="markdown", nullable=False, comment="内容类型"
    )
    summary: Mapped[str | None] = mapped_column(Text, nullable=True, comment="摘要")
    category_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("article_categories.id"), nullable=True, index=True, comment="分类 ID"
    )
    author_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True, index=True, comment="作者 ID"
    )
    view_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False, comment="浏览量")

    # 封面图
    cover_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True, comment="封面图 URL")
    cover_image_alt: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="封面图替代文本")

    # 置顶
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False, comment="是否置顶")
    pin_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False, comment="置顶排序")
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, comment="置顶时间")

    # SEO
    seo_title: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="SEO 标题")
    seo_description: Mapped[str | None] = mapped_column(String(500), nullable=True, comment="SEO 描述")
    seo_keywords: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="SEO 关键词")
    seo_slug: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True, index=True, comment="SEO slug")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # relationships
    category: Mapped[ArticleCategory | None] = relationship("ArticleCategory", back_populates="articles", lazy="selectin")

    def to_dict(self, include_content: bool = True) -> dict:
        d = {
            "id": self.id,
            "title": self.title,
            "status": self.status,
            "content_type": self.content_type,
            "summary": self.summary,
            "category_id": self.category_id,
            "author_id": self.author_id,
            "view_count": self.view_count,
            "cover_image_url": self.cover_image_url,
            "cover_image_alt": self.cover_image_alt,
            "is_pinned": self.is_pinned,
            "pin_order": self.pin_order,
            "pinned_at": self.pinned_at.isoformat() if self.pinned_at else None,
            "seo_title": self.seo_title,
            "seo_description": self.seo_description,
            "seo_keywords": self.seo_keywords,
            "seo_slug": self.seo_slug,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_content:
            d["content"] = self.content
        if self.category:
            d["category"] = self.category.to_dict()
        return d


class ArticleMedia(Base):
    """文章媒体文件。"""
    __tablename__ = "article_media"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False, comment="文件名")
    original_name: Mapped[str] = mapped_column(String(255), nullable=False, comment="原始文件名")
    file_path: Mapped[str] = mapped_column(String(512), nullable=False, comment="文件路径")
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, comment="文件大小 (bytes)")
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False, comment="MIME 类型")
    url: Mapped[str] = mapped_column(String(512), nullable=False, comment="公开访问 URL")
    alt: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="替代文本")
    uploader_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True, comment="上传者 ID"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
