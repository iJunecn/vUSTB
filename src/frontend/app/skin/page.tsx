'use client';

import Link from 'next/link';
import { Library, Settings, Upload } from 'lucide-react';

export default function SkinHome() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '64px 24px', display: 'flex', flexDirection: 'column', gap: 48 }}>
      {/* Header */}
      <div>
        <span
          style={{
            display: 'inline-block', padding: '4px 12px', borderRadius: 999,
            background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
            color: 'var(--color-primary)', fontSize: 13, fontWeight: 600, marginBottom: 16,
          }}
        >
          基于 Yggdrasil 协议 · authlib-injector 兼容
        </span>
        <h1 style={{ fontSize: 40, fontWeight: 800, color: 'var(--color-heading)', margin: '0 0 12px 0', letterSpacing: '-0.5px' }}>
          像素北科 皮肤站
        </h1>
        <p style={{ fontSize: 16, color: 'var(--color-text-light)', maxWidth: 600, lineHeight: 1.6 }}>
          上传你的皮肤，绑定到 Minecraft 角色，通过 authlib-injector 在客户端中无缝使用，
          也可以浏览社区公共皮肤库。
        </p>
      </div>

      {/* Entry cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
        <EntryCard
          href="/skin/library"
          icon={<Library style={{ width: 24, height: 24 }} />}
          title="皮肤库"
          desc="浏览社区上传的公共皮肤与披风，一键收藏到你的衣柜。"
        />
        <EntryCard
          href="/skin/upload"
          icon={<Upload style={{ width: 24, height: 24 }} />}
          title="上传皮肤"
          desc="把你的皮肤加入个人衣柜，或公开分享给所有人。"
        />
        <EntryCard
          href="/skin/settings"
          icon={<Settings style={{ width: 24, height: 24 }} />}
          title="皮肤站设置"
          desc="在 MC 客户端配置 authlib-injector，接入像素北科皮肤站。"
        />
      </div>
    </div>
  );
}

function EntryCard({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="surface-card hoverable"
      style={{
        padding: 28, textDecoration: 'none',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}
    >
      <div
        style={{
          width: 48, height: 48, borderRadius: 12,
          background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--color-primary)',
        }}
      >
        {icon}
      </div>
      <div>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 4px 0' }}>{title}</h3>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', margin: 0, lineHeight: 1.5 }}>{desc}</p>
      </div>
    </Link>
  );
}
