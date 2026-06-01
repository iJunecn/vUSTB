'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ArrowLeft, Calendar, Eye, Tag, Edit } from 'lucide-react';
import { useUserStore } from '@/stores/user';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';

type Category = {
  id: number;
  name: string;
};

type ArticleDetail = {
  id: number;
  title: string;
  content: string;
  content_type: string;
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

export default function ArticleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loaded } = useUserStore();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const articleId = params.id as string;

  useEffect(() => {
    api.get<ArticleDetail>(`/articles/${articleId}`)
      .then((r) => setArticle(r.data))
      .catch(() => setArticle(null))
      .finally(() => setLoading(false));
  }, [articleId]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const isAdmin = loaded && user && ['super_admin', 'admin'].includes(user.user_group);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', paddingTop: 56, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <span style={{ color: 'var(--color-text-light)' }}>加载中...</span>
      </div>
    );
  }

  if (!article) {
    return (
      <div style={{ minHeight: '100vh', paddingTop: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <span style={{ color: 'var(--color-text-light)', fontSize: 18 }}>文章不存在</span>
        <button onClick={() => router.push('/dynamics')} className="btn-ghost">返回动态列表</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', paddingTop: 56 }}>
      <article style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px' }}>
        {/* Back + Edit */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <button
            onClick={() => router.push('/dynamics')}
            className="btn-ghost"
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            <ArrowLeft style={{ width: 14, height: 14 }} /> 返回列表
          </button>
          {isAdmin && (
            <Link href={`/admin/dynamics/${article.id}`}>
              <button className="btn-ghost" style={{ padding: '8px 16px', fontSize: 13 }}>
                <Edit style={{ width: 14, height: 14 }} /> 编辑
              </button>
            </Link>
          )}
        </div>

        {/* Cover */}
        {article.cover_image_url && (
          <div style={{
            width: '100%', maxHeight: 400, borderRadius: 12, overflow: 'hidden',
            marginBottom: 24,
          }}>
            <img
              src={article.cover_image_url}
              alt={article.cover_image_alt || article.title}
              style={{ width: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
        )}

        {/* Header */}
        <header style={{ marginBottom: 32 }}>
          {/* Meta */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            {article.category && (
              <span className="dynamics-cat-pill">{article.category.name}</span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--color-text-light)' }}>
              <Calendar style={{ width: 14, height: 14 }} /> {formatDate(article.created_at)}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--color-text-light)' }}>
              <Eye style={{ width: 14, height: 14 }} /> {article.view_count}
            </span>
          </div>

          <h1 style={{
            fontSize: 32, fontWeight: 700, lineHeight: 1.3,
            color: 'var(--color-heading)', margin: 0,
          }}>
            {article.title}
          </h1>

          {article.summary && (
            <p style={{
              fontSize: 16, color: 'var(--color-text-light)',
              marginTop: 12, lineHeight: 1.6,
            }}>
              {article.summary}
            </p>
          )}
        </header>

        {/* Content */}
        <div className="article-content prose-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, rehypeSlug]}
          >
            {article.content}
          </ReactMarkdown>
        </div>

        {/* Footer */}
        <footer style={{
          marginTop: 48, paddingTop: 20,
          borderTop: '1px solid var(--color-border)',
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', flexWrap: 'wrap', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text-light)' }}>
            <Tag style={{ width: 14, height: 14 }} />
            {article.category?.name || '未分类'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-light)' }}>
            更新于 {formatDate(article.updated_at)}
          </div>
        </footer>
      </article>
    </div>
  );
}
