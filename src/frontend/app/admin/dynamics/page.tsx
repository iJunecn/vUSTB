'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  Plus, Edit, Trash2, Pin, PinOff, Eye, Calendar,
  FolderPlus, Loader2, X,
} from 'lucide-react';
import { toast } from 'sonner';

type Category = {
  id: number;
  name: string;
  description: string | null;
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
  is_pinned: boolean;
  pin_order: number;
  seo_slug: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export default function AdminDynamicsPage() {
  const [articles, setArticles] = useState<ArticleDetail[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Category form
  const [showCatForm, setShowCatForm] = useState(false);
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catSaving, setCatSaving] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'article' | 'category'; id: number; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = async () => {
    try {
      const [arts, cats] = await Promise.all([
        api.get<ArticleDetail[]>('/admin/articles'),
        api.get<Category[]>('/admin/article-categories'),
      ]);
      setArticles(arts.data);
      setCategories(cats.data);
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreateCategory = async () => {
    if (!catName.trim()) return;
    setCatSaving(true);
    try {
      await api.post('/admin/article-categories', { name: catName.trim(), description: catDesc.trim() || null });
      toast.success('分类创建成功');
      setCatName('');
      setCatDesc('');
      setShowCatForm(false);
      fetchData();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '创建失败');
    } finally {
      setCatSaving(false);
    }
  };

  const handleDeleteCategory = async (id: number) => {
    setDeleting(true);
    try {
      await api.delete(`/admin/article-categories/${id}`);
      toast.success('分类已删除');
      setDeleteTarget(null);
      fetchData();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleTogglePin = async (article: ArticleDetail) => {
    try {
      const newPinned = !article.is_pinned;
      await api.put(`/admin/articles/${article.id}`, {
        is_pinned: newPinned,
        pin_order: newPinned ? 1 : 0,
      });
      toast.success(newPinned ? '已置顶' : '已取消置顶');
      fetchData();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '操作失败');
    }
  };

  const handleDeleteArticle = async (id: number) => {
    setDeleting(true);
    try {
      await api.delete(`/admin/articles/${id}`);
      toast.success('文章已删除');
      setDeleteTarget(null);
      fetchData();
    } catch {
      toast.error('删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const isScheduled = (a: ArticleDetail) => a.created_at && new Date(a.created_at) > new Date();

  const formatDate = (d: string | null) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Header */}
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>DYNAMICS</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>动态管理</h1>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <StatsCard label="总文章数" value={articles.length} color="#2f78ba" />
        <StatsCard label="已发布" value={articles.filter((a) => !isScheduled(a)).length} color="#22c55e" />
        <StatsCard label="定时发布" value={articles.filter((a) => isScheduled(a)).length} color="#eab308" />
        <StatsCard label="总浏览量" value={articles.reduce((s, a) => s + (a.view_count || 0), 0)} color="#a855f7" />
      </div>

      {/* Articles Section */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>文章列表</h2>
          <Link href="/admin/dynamics/new">
            <button className="btn-primary" style={{ padding: '8px 18px', fontSize: 13 }}>
              <Plus style={{ width: 15, height: 15 }} /> 创建文章
            </button>
          </Link>
        </div>

        {articles.length === 0 ? (
          <div className="surface-card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-light)' }}>
            暂无文章，点击上方按钮创建第一篇
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {articles.map((article) => (
              <div key={article.id} className="surface-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                {/* Category badge */}
                {article.category && (
                  <span className="dynamics-cat-pill" style={{ flexShrink: 0 }}>{article.category.name}</span>
                )}

                {/* Title */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {article.is_pinned && (
                      <Pin style={{ width: 14, height: 14, color: 'var(--color-primary)', flexShrink: 0 }} />
                    )}
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {article.title}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, fontSize: 12, color: 'var(--color-text-light)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Calendar style={{ width: 12, height: 12 }} /> {formatDate(article.created_at)}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Eye style={{ width: 12, height: 12 }} /> {article.view_count}
                    </span>
                    {isScheduled(article) && (
                      <span style={{ color: '#eab308', fontWeight: 600 }}>定时发布</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => handleTogglePin(article)}
                    className="btn-ghost"
                    style={{ padding: '4px 8px', fontSize: 12, minWidth: 'auto' }}
                    title={article.is_pinned ? '取消置顶' : '置顶'}
                  >
                    {article.is_pinned ? <PinOff style={{ width: 14, height: 14 }} /> : <Pin style={{ width: 14, height: 14 }} />}
                  </button>
                  <Link href={`/admin/dynamics/${article.id}`}>
                    <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: 12, minWidth: 'auto' }} title="编辑">
                      <Edit style={{ width: 14, height: 14 }} />
                    </button>
                  </Link>
                  <button
                    onClick={() => setDeleteTarget({ type: 'article', id: article.id, name: article.title })}
                    className="btn-ghost"
                    style={{ padding: '4px 8px', fontSize: 12, minWidth: 'auto', color: '#dc2626' }}
                    title="删除"
                  >
                    <Trash2 style={{ width: 14, height: 14 }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Categories Section */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>分类管理</h2>
          <button
            onClick={() => setShowCatForm(!showCatForm)}
            className="btn-ghost"
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            <FolderPlus style={{ width: 15, height: 15 }} /> 新建分类
          </button>
        </div>

        {/* New category form */}
        {showCatForm && (
          <div className="surface-card" style={{ padding: 16, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', display: 'block', marginBottom: 4 }}>分类名称</label>
              <input className="input" value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="例如：公告" />
            </div>
            <div style={{ flex: '2 1 300px' }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-light)', display: 'block', marginBottom: 4 }}>描述（可选）</label>
              <input className="input" value={catDesc} onChange={(e) => setCatDesc(e.target.value)} placeholder="分类简述" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleCreateCategory} className="btn-primary" style={{ padding: '8px 16px', fontSize: 13 }} disabled={catSaving}>
                {catSaving ? '保存中...' : '保存'}
              </button>
              <button onClick={() => { setShowCatForm(false); setCatName(''); setCatDesc(''); }} className="btn-ghost" style={{ padding: '8px 12px', fontSize: 13 }}>
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>
        )}

        {categories.length === 0 ? (
          <div className="surface-card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-light)' }}>
            暂无分类
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {categories.map((cat) => (
              <div key={cat.id} className="surface-card" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-heading)' }}>{cat.name}</div>
                  {cat.description && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-light)', marginTop: 2 }}>{cat.description}</div>
                  )}
                </div>
                <button
                  onClick={() => setDeleteTarget({ type: 'category', id: cat.id, name: cat.name })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 4 }}
                  title="删除分类"
                >
                  <Trash2 style={{ width: 14, height: 14 }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="surface-card"
            style={{ padding: 24, maxWidth: 400, width: '90%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 8px' }}>
              确认删除
            </h3>
            <p style={{ fontSize: 14, color: 'var(--color-text-light)', margin: '0 0 20px' }}>
              确定要删除{deleteTarget.type === 'article' ? '文章' : '分类'}「{deleteTarget.name}」吗？此操作不可撤销。
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} className="btn-ghost" style={{ padding: '8px 16px', fontSize: 13 }}>
                取消
              </button>
              <button
                onClick={() => {
                  if (deleteTarget.type === 'article') handleDeleteArticle(deleteTarget.id);
                  else handleDeleteCategory(deleteTarget.id);
                }}
                className="btn-destructive"
                style={{ padding: '8px 16px', fontSize: 13 }}
                disabled={deleting}
              >
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatsCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="surface-card" style={{ padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-light)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
