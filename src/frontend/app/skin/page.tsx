'use client';

import Link from 'next/link';
import { Library, Settings, Upload } from 'lucide-react';

export default function SkinHome() {
  return (
    <div className="page-container flex-col-gap-lg">
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
        <h1 className="page-hero-title">
          像素北科 皮肤站
        </h1>
        <p className="page-hero-subtitle">
          上传你的皮肤，绑定到 Minecraft 角色，通过 authlib-injector 在客户端中无缝使用，
          也可以浏览社区公开皮肤与你的私有材质。
        </p>
      </div>

      {/* Entry cards */}
      <div className="grid-entry-cards">
        <EntryCard
          href="/skin/library"
          icon={<Library style={{ width: 24, height: 24 }} />}
          title="皮肤库"
          desc="浏览所有公开材质和你的私有材质，一键收藏到衣柜。"
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
      className="surface-card hoverable entry-card"
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
