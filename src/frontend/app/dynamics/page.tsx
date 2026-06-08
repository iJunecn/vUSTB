'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Calendar, Eye, Pin, Search, ArrowRight, Rss } from 'lucide-react';

type Category = {
  id: number;
  name: string;
  description: string | null;
};

type ArticleListItem = {
  id: number;
  title: string;
  summary: string | null;
  category_id: number | null;
  category: Category | null;
  view_count: number;
  cover_image_url: string | null;
  cover_image_alt: string | null;
  is_pinned: boolean;
  seo_slug: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export default function DynamicsPage() {
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Category[]>('/articles/categories')
      .then((r) => setCategories(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (selectedCategory !== null) params.category_id = String(selectedCategory);
    if (searchQuery) params.q = searchQuery;

    const endpoint = searchQuery ? '/articles/search' : '/articles';
    api.get<ArticleListItem[]>(endpoint, { params })
      .then((r) => setArticles(r.data))
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  }, [selectedCategory, searchQuery]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const pinnedArticles = articles.filter((a) => a.is_pinned);
  const normalArticles = articles.filter((a) => !a.is_pinned);

  return (
    <div style={{ minHeight: '100vh', paddingTop: 56 }}>
      <div className="page-container" style={{ paddingTop: '40px', paddingBottom: '40px' }}>
        <div style={{ marginBottom: 32 }}>
          <p className="section-kicker" style={{ marginBottom: 8 }}>DYNAMICS</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
              动态
            </h1>
            <a
              href="/api/articles/rss"
              target="_blank"
              rel="noreferrer"
              title="RSS 订阅"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                color: 'var(--color-primary)',
                border: '1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)',
                textDecoration: 'none',
                transition: 'background 0.2s',
              }}
            >
              <Rss style={{ width: 14, height: 14 }} />
              RSS
            </a>
          </div>
          <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 8 }}>
            像素北科团队发布的最新动态与文章
          </p>
        </div>

        <div style={{ position: 'relative', marginBottom: 24 }}>
          <Search
            style={{
              position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
              width: 18, height: 18, color: 'var(--color-text-light)',
            }}
          />
          <input
            className="input"
            type="text"
            placeholder="搜索文章..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: 40 }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 32 }}>
          <button
            onClick={() => setSelectedCategory(null)}
            className="dynamics-cat-btn"
            style={{
              background: selectedCategory === null
                ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)'
                : 'var(--color-background-soft)',
              color: selectedCategory === null ? 'var(--color-primary)' : 'var(--color-text-light)',
              border: '1px solid',
              borderColor: selectedCategory === null
                ? 'color-mix(in srgb, var(--color-primary) 20%, transparent)'
                : 'var(--color-border)',
            }}
          >
            全部
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className="dynamics-cat-btn"
              style={{
                background: selectedCategory === cat.id
                  ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)'
                  : 'var(--color-background-soft)',
                color: selectedCategory === cat.id ? 'var(--color-primary)' : 'var(--color-text-light)',
                border: '1px solid',
                borderColor: selectedCategory === cat.id
                  ? 'color-mix(in srgb, var(--color-primary) 20%, transparent)'
                  : 'var(--color-border)',
              }}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-text-light)' }}>
            加载中...
          </div>
        )}

        {!loading && articles.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-text-light)' }}>
            暂无文章
          </div>
        )}

        {!loading && pinnedArticles.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Pin style={{ width: 16, height: 16, color: 'var(--color-primary)' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-heading)' }}>置顶</span>
            </div>
            <div className="grid-articles">
              {pinnedArticles.map((article) => (
                <ArticleCard key={article.id} article={article} formatDate={formatDate} />
              ))}
            </div>
          </div>
        )}

        {!loading && normalArticles.length > 0 && (
          <div className="grid-articles">
            {normalArticles.map((article) => (
              <ArticleCard key={article.id} article={article} formatDate={formatDate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ArticleCard({
  article,
  formatDate,
}: {
  article: ArticleListItem;
  formatDate: (d: string | null) => string;
}) {
  const href = article.seo_slug ? `/dynamics/${article.seo_slug}` : `/dynamics/${article.id}`;

  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div className="surface-card hoverable dynamics-article-card">
        {article.cover_image_url && (
          <div style={{ width: '100%', height: 160, overflow: 'hidden', borderRadius: '12px 12px 0 0' }}>
            <img
              src={article.cover_image_url}
              alt={article.cover_image_alt || article.title}
              style={{
                width: '100%', height: '100%', objectFit: 'cover',
                transition: 'transform 0.3s ease',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.transform = 'scale(1.05)'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.transform = 'scale(1)'; }}
            />
          </div>
        )}

        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            {article.category && (
              <span className="dynamics-cat-pill">{article.category.name}</span>
            )}
            {article.is_pinned && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--color-primary)', fontWeight: 600 }}>
                <Pin style={{ width: 12, height: 12 }} /> 置顶
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-light)' }}>
              <Calendar style={{ width: 13, height: 13 }} /> {formatDate(article.created_at)}
            </span>
            {article.view_count > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-light)' }}>
                <Eye style={{ width: 13, height: 13 }} /> {article.view_count}
              </span>
            )}
          </div>

          <h3 style={{ fontSize: 17, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 8px', lineHeight: 1.4 }}>
            {article.title}
          </h3>

          {article.summary && (
            <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: 0, lineHeight: 1.6,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
            }}>
              {article.summary}
            </p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 14, fontSize: 13, color: 'var(--color-primary)', fontWeight: 500 }}>
            阅读更多 <ArrowRight style={{ width: 14, height: 14 }} />
          </div>
        </div>
      </div>
    </Link>
  );
}
