'use client';

import { useEffect, useState, useRef } from 'react';
import { api } from '@/lib/api';
import {
  Upload, Trash2, Copy, Loader2, ImageIcon, Search, Check,
} from 'lucide-react';
import { toast } from 'sonner';

type MediaItem = {
  id: number;
  file_name: string;
  original_name: string;
  url: string;
  alt: string | null;
  mime_type: string;
  file_size: number;
  created_at: string | null;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: string | null): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminMediaPage() {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMedia = async () => {
    try {
      const res = await api.get<MediaItem[]>('/admin/article-media');
      setMedia(res.data);
    } catch {
      toast.error('加载媒体列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMedia(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formData = new FormData();
      formData.append('file', file);
      try {
        await api.post('/admin/article-media/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        successCount++;
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) toast.success(`成功上传 ${successCount} 个文件`);
    if (failCount > 0) toast.error(`${failCount} 个文件上传失败`);

    setUploading(false);
    // Reset the input so the same file(s) can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
    fetchMedia();
  };

  const handleCopyLink = async (item: MediaItem) => {
    // Build the full URL from the relative path
    const fullUrl = `${window.location.origin}${item.url}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedId(item.id);
      toast.success('链接已复制');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback: use textarea trick
      const ta = document.createElement('textarea');
      ta.value = fullUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedId(item.id);
      toast.success('链接已复制');
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleCopyMarkdown = async (item: MediaItem) => {
    const md = `![${item.original_name}](${item.url})`;
    try {
      await navigator.clipboard.writeText(md);
      toast.success('Markdown 已复制');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast.success('Markdown 已复制');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/article-media/${deleteTarget.id}`);
      toast.success('文件已删除');
      setDeleteTarget(null);
      fetchMedia();
    } catch {
      toast.error('删除失败');
    } finally {
      setDeleting(false);
    }
  };

  // Filter by search
  const filteredMedia = searchQuery
    ? media.filter((m) =>
        m.original_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.url.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : media;

  // Stats
  const totalSize = media.reduce((s, m) => s + m.file_size, 0);
  const imageCount = media.filter((m) => m.mime_type.startsWith('image/')).length;
  const videoCount = media.filter((m) => m.mime_type.startsWith('video/')).length;

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
        <p className="section-kicker" style={{ marginBottom: 8 }}>MEDIA</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>图片管理</h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 8 }}>
          管理文章媒体文件，上传图片、复制链接、删除不需要的文件
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <div className="surface-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-light)', marginBottom: 4 }}>总文件数</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#2f78ba' }}>{media.length}</div>
        </div>
        <div className="surface-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-light)', marginBottom: 4 }}>图片</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{imageCount}</div>
        </div>
        <div className="surface-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-light)', marginBottom: 4 }}>视频</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#eab308' }}>{videoCount}</div>
        </div>
        <div className="surface-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-light)', marginBottom: 4 }}>占用空间</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#a855f7' }}>{formatFileSize(totalSize)}</div>
        </div>
      </div>

      {/* Upload + Search bar */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="btn-primary" style={{ padding: '8px 18px', fontSize: 13, cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
          {uploading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> 上传中...</>
          ) : (
            <><Upload style={{ width: 15, height: 15 }} /> 上传文件</>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/mp4"
            multiple
            onChange={handleUpload}
            style={{ display: 'none' }}
            disabled={uploading}
          />
        </label>
        <div style={{ flex: '1 1 240px', position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'var(--color-text-light)' }} />
          <input
            className="input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索文件名..."
            style={{ paddingLeft: 38 }}
          />
        </div>
      </div>

      {/* Grid */}
      {filteredMedia.length === 0 ? (
        <div className="surface-card" style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-light)' }}>
          <ImageIcon style={{ width: 48, height: 48, margin: '0 auto 16px', opacity: 0.3, display: 'block' }} />
          {searchQuery ? '没有匹配的文件' : '暂无文件，点击上方按钮上传'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
          {filteredMedia.map((item) => (
            <div key={item.id} className="surface-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Thumbnail */}
              <div style={{
                width: '100%', height: 140, background: 'var(--color-background-soft)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                position: 'relative',
              }}>
                {item.mime_type.startsWith('image/') ? (
                  <img
                    src={item.url}
                    alt={item.alt || item.original_name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    loading="lazy"
                  />
                ) : (
                  <ImageIcon style={{ width: 40, height: 40, color: 'var(--color-text-light)', opacity: 0.4 }} />
                )}
              </div>

              {/* Info */}
              <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div
                  style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={item.original_name}
                >
                  {item.original_name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-light)' }}>
                  {formatFileSize(item.file_size)} · {formatDate(item.created_at)}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleCopyLink(item)}
                    className="btn-ghost"
                    style={{ padding: '3px 8px', fontSize: 11, minWidth: 'auto', gap: 4, display: 'flex', alignItems: 'center' }}
                    title="复制链接"
                  >
                    {copiedId === item.id ? (
                      <><Check style={{ width: 12, height: 12, color: '#22c55e' }} /> <span style={{ color: '#22c55e' }}>已复制</span></>
                    ) : (
                      <><Copy style={{ width: 12, height: 12 }} /> 链接</>
                    )}
                  </button>
                  <button
                    onClick={() => handleCopyMarkdown(item)}
                    className="btn-ghost"
                    style={{ padding: '3px 8px', fontSize: 11, minWidth: 'auto' }}
                    title="复制 Markdown"
                  >
                    MD
                  </button>
                  <button
                    onClick={() => setDeleteTarget(item)}
                    style={{
                      padding: '3px 8px', fontSize: 11, minWidth: 'auto',
                      display: 'flex', alignItems: 'center', gap: 4,
                      background: 'var(--color-background-soft)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 10, cursor: 'pointer', color: '#dc2626',
                    }}
                    title="删除"
                  >
                    <Trash2 style={{ width: 12, height: 12 }} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

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
            style={{ padding: 24, maxWidth: 420, width: '90%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 8px' }}>
              确认删除
            </h3>
            <p style={{ fontSize: 14, color: 'var(--color-text-light)', margin: '0 0 12px' }}>
              确定要删除文件「{deleteTarget.original_name}」吗？如果该文件在文章中被引用，删除后文章中的图片将无法显示。
            </p>
            {deleteTarget.mime_type.startsWith('image/') && (
              <div style={{ marginBottom: 16, borderRadius: 8, overflow: 'hidden', maxHeight: 120 }}>
                <img src={deleteTarget.url} alt="" style={{ width: '100%', objectFit: 'cover' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} className="btn-ghost" style={{ padding: '8px 16px', fontSize: 13 }}>
                取消
              </button>
              <button
                onClick={handleDelete}
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
