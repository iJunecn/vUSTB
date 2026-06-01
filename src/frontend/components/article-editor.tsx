'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ArrowLeft, Save, Eye, Loader2, ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';

type Category = {
  id: number;
  name: string;
};

export function ArticleEditor({ articleId }: { articleId: number | null }) {
  const router = useRouter();

  // Form state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [coverImageAlt, setCoverImageAlt] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [seoKeywords, setSeoKeywords] = useState('');
  const [seoSlug, setSeoSlug] = useState('');

  // UI state
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(articleId !== null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    api.get<Category[]>('/articles/categories')
      .then((r) => setCategories(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (articleId) {
      api.get<{
        id: number; title: string; content: string; summary: string;
        category_id: number | null; cover_image_url: string | null; cover_image_alt: string | null;
        is_pinned: boolean; seo_title: string | null; seo_description: string | null;
        seo_keywords: string | null; seo_slug: string | null;
      }>(`/admin/articles/${articleId}`)
        .then((r) => {
          const d = r.data;
          setTitle(d.title);
          setContent(d.content);
          setSummary(d.summary || '');
          setCategoryId(d.category_id);
          setCoverImageUrl(d.cover_image_url || '');
          setCoverImageAlt(d.cover_image_alt || '');
          setIsPinned(d.is_pinned);
          setSeoTitle(d.seo_title || '');
          setSeoDescription(d.seo_description || '');
          setSeoKeywords(d.seo_keywords || '');
          setSeoSlug(d.seo_slug || '');
        })
        .catch(() => toast.error('加载文章失败'))
        .finally(() => setLoading(false));
    }
  }, [articleId]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('请输入标题');
      return;
    }
    if (!content.trim()) {
      toast.error('请输入内容');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        content: content,
        content_type: 'markdown',
        summary: summary.trim() || null,
        category_id: categoryId,
        cover_image_url: coverImageUrl.trim() || null,
        cover_image_alt: coverImageAlt.trim() || null,
        is_pinned: isPinned,
        pin_order: isPinned ? 1 : 0,
        seo_title: seoTitle.trim() || null,
        seo_description: seoDescription.trim() || null,
        seo_keywords: seoKeywords.trim() || null,
        seo_slug: seoSlug.trim() || null,
      };

      if (articleId) {
        await api.put(`/admin/articles/${articleId}`, payload);
        toast.success('文章已更新');
      } else {
        await api.post('/admin/articles', payload);
        toast.success('文章已创建');
      }
      router.push('/admin/dynamics');
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/admin/article-media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = res.data.url;
      const imgMd = `![${file.name}](${url})`;
      setContent((prev) => prev + '\n' + imgMd);
      toast.success('图片已上传');
    } catch {
      toast.error('图片上传失败');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/admin/dynamics')} className="btn-ghost" style={{ padding: '6px 12px', fontSize: 13 }}>
            <ArrowLeft style={{ width: 14, height: 14 }} /> 返回
          </button>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
            {articleId ? '编辑文章' : '创建文章'}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="btn-ghost"
            style={{ padding: '8px 14px', fontSize: 13 }}
          >
            <Eye style={{ width: 14, height: 14 }} /> {showPreview ? '编辑' : '预览'}
          </button>
          <button
            onClick={handleSave}
            className="btn-primary"
            style={{ padding: '8px 18px', fontSize: 13 }}
            disabled={saving}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save style={{ width: 14, height: 14 }} />}
            {' '}{saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: showPreview ? '1fr 1fr' : '1fr', gap: 20, alignItems: 'start' }}>
        {/* Editor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Title */}
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="文章标题"
            style={{ fontSize: 18, fontWeight: 600, padding: '12px 16px' }}
          />

          {/* Category + Pin */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select
              className="input"
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
              style={{ flex: '1 1 200px' }}
            >
              <option value="">无分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
              置顶
            </label>
          </div>

          {/* Summary */}
          <input
            className="input"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="摘要（可选，显示在列表中）"
          />

          {/* Content editor */}
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <label className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                <ImagePlus style={{ width: 13, height: 13 }} /> 插入图片
                <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
              </label>
            </div>
            <textarea
              className="input"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Markdown 内容..."
              style={{
                minHeight: 400,
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                fontSize: 14,
                lineHeight: 1.6,
                resize: 'vertical',
              }}
            />
          </div>

          {/* Cover Image URL */}
          <input
            className="input"
            value={coverImageUrl}
            onChange={(e) => setCoverImageUrl(e.target.value)}
            placeholder="封面图 URL（可选）"
          />

          {/* SEO Section (collapsible) */}
          <details style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
            <summary style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--color-text-light)', background: 'var(--color-background-soft)' }}>
              SEO 设置（可选）
            </summary>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input className="input" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder="SEO 标题" />
              <input className="input" value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} placeholder="SEO 描述" />
              <input className="input" value={seoKeywords} onChange={(e) => setSeoKeywords(e.target.value)} placeholder="SEO 关键词（逗号分隔）" />
              <input className="input" value={seoSlug} onChange={(e) => setSeoSlug(e.target.value)} placeholder="URL slug（例如：my-article）" />
            </div>
          </details>
        </div>

        {/* Preview */}
        {showPreview && (
          <div className="surface-card" style={{ padding: 24, maxHeight: '80vh', overflowY: 'auto' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-heading)', margin: '0 0 16px' }}>
              {title || '文章标题'}
            </h1>
            {summary && (
              <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginBottom: 16 }}>{summary}</p>
            )}
            <div className="article-content prose-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeSlug]}
              >
                {content || '*暂无内容*'}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
