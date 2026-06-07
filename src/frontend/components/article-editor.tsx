'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ArrowLeft, Save, Loader2, ImagePlus, FileText, Send } from 'lucide-react';
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

  // Article status (for editing existing articles)
  const [articleStatus, setArticleStatus] = useState<string>('published');

  // UI state
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [loading, setLoading] = useState(articleId !== null);

  // Textarea ref + cursor tracking for image insertion at cursor position
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cursorPosRef = useRef(0);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    cursorPosRef.current = e.target.selectionStart;
  }, []);

  const handleContentSelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    cursorPosRef.current = ta.selectionStart;
  }, []);

  const handleContentClick = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    cursorPosRef.current = e.currentTarget.selectionStart;
  }, []);

  const handleContentKeyUp = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    cursorPosRef.current = e.currentTarget.selectionStart;
  }, []);

  /** Insert text at the current cursor position in the textarea */
  const insertAtCursor = useCallback((insertText: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      // fallback: append at end
      setContent((prev) => prev + insertText);
      return;
    }

    const pos = cursorPosRef.current;
    const before = content.slice(0, pos);
    const after = content.slice(pos);

    const newContent = before + insertText + after;
    setContent(newContent);

    // Set cursor after inserted text on next frame
    const newPos = pos + insertText.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
      cursorPosRef.current = newPos;
    });
  }, [content]);

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
        seo_keywords: string | null; seo_slug: string | null; status: string;
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
          setArticleStatus(d.status || 'published');
          // Initialize cursor at end
          cursorPosRef.current = d.content.length;
        })
        .catch(() => toast.error('加载文章失败'))
        .finally(() => setLoading(false));
    }
  }, [articleId]);

  const buildPayload = (status: string) => ({
    title: title.trim(),
    content: content,
    content_type: 'markdown',
    status,
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
  });

  const handlePublish = async () => {
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
      const payload = buildPayload('published');
      if (articleId) {
        await api.put(`/admin/articles/${articleId}`, payload);
        toast.success('文章已发布');
      } else {
        await api.post('/admin/articles', payload);
        toast.success('文章已创建并发布');
      }
      router.push('/admin/dynamics');
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '发布失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!title.trim()) {
      toast.error('请输入标题');
      return;
    }
    setSavingDraft(true);
    try {
      const payload = buildPayload('draft');
      if (articleId) {
        await api.put(`/admin/articles/${articleId}`, payload);
        toast.success('草稿已保存');
        setArticleStatus('draft');
      } else {
        const res = await api.post('/admin/articles', payload);
        toast.success('草稿已保存');
        // Update articleId so subsequent saves are updates, not creates
        const newId = res.data?.id;
        if (newId) {
          router.replace(`/admin/dynamics/${newId}`);
        }
        setArticleStatus('draft');
      }
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '保存草稿失败');
    } finally {
      setSavingDraft(false);
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
      insertAtCursor(imgMd);
      toast.success('图片已上传并插入');
    } catch {
      toast.error('图片上传失败');
    }
    // Reset the file input so the same file can be re-selected
    e.target.value = '';
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/admin/dynamics')} className="btn-ghost" style={{ padding: '6px 12px', fontSize: 13 }}>
            <ArrowLeft style={{ width: 14, height: 14 }} /> 返回
          </button>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
            {articleId ? '编辑文章' : '创建文章'}
          </h2>
          {articleStatus === 'draft' && (
            <span style={{
              fontSize: 12, fontWeight: 600, color: '#d97706',
              background: '#fef3c7', padding: '2px 8px',
              borderRadius: 6, border: '1px solid #fcd34d',
            }}>
              草稿
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSaveDraft}
            className="btn-ghost"
            style={{ padding: '8px 14px', fontSize: 13 }}
            disabled={savingDraft}
          >
            {savingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText style={{ width: 14, height: 14 }} />}
            {' '}{savingDraft ? '保存中...' : '保存草稿'}
          </button>
          <button
            onClick={handlePublish}
            className="btn-primary"
            style={{ padding: '8px 18px', fontSize: 13 }}
            disabled={saving}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send style={{ width: 14, height: 14 }} />}
            {' '}{saving ? '发布中...' : '发布'}
          </button>
        </div>
      </div>

      {/* Split layout: left editor + right preview */}
      <div className="article-editor-split">
        {/* Left: Editor */}
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
              ref={textareaRef}
              className="input"
              value={content}
              onChange={handleContentChange}
              onSelect={handleContentSelect}
              onClick={handleContentClick}
              onKeyUp={handleContentKeyUp}
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

        {/* Right: Live Markdown Preview */}
        <div className="surface-card" style={{ padding: 24, maxHeight: '80vh', overflowY: 'auto', position: 'sticky', top: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-heading)', margin: '0 0 8px' }}>
            {title || '文章标题'}
          </h1>
          {articleStatus === 'draft' && (
            <span style={{
              display: 'inline-block', fontSize: 11, fontWeight: 600, color: '#d97706',
              background: '#fef3c7', padding: '1px 6px', borderRadius: 4, marginBottom: 8,
            }}>
              草稿
            </span>
          )}
          {summary && (
            <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginBottom: 16, borderLeft: '3px solid var(--color-primary)', paddingLeft: 12 }}>{summary}</p>
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
      </div>
    </div>
  );
}
