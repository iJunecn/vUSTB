'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUserStore } from '@/stores/user';
import { api } from '@/lib/api';
import { ArrowRight } from 'lucide-react';

type SiteSettings = {
  site_name?: string;
  site_title?: string;
  site_subtitle?: string;
};

export default function HomePage() {
  const { user, loaded, hydrate } = useUserStore();
  const [settings, setSettings] = useState<SiteSettings>({});

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    api.get<SiteSettings>('/public/settings')
      .then((r) => setSettings(r.data))
      .catch(() => {});
  }, []);

  const siteName = settings.site_title || settings.site_name || '像素北科';
  const siteSubtitle = settings.site_subtitle || '北京科技大学 Minecraft 数字校园社区';

  return (
    <div className="home-container">
      {/* Background */}
      <div className="home-bg">
        <picture>
          <source srcSet="/img/background.webp" type="image/webp" />
          <img src="/img/background.jpg" alt="" />
        </picture>
      </div>

      {/* Overlay */}
      <div className="home-bg-overlay" />

      {/* Content */}
      <div className="home-content">
        <div className="home-card">
          <h1 className="home-card-title">{siteName}</h1>
          <p className="home-card-desc">{siteSubtitle}</p>
          <Link href="/about" className="home-card-btn">
            查看更多 <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Footer on homepage */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 2,
        padding: '12px 0',
        textAlign: 'center',
      }}>
        <p style={{
          fontSize: 12,
          color: 'rgba(255, 255, 255, 0.6)',
          margin: 0,
        }}>
          北京科技大学学生天码智能社 &copy; {new Date().getFullYear()} 像素北科
        </p>
      </div>
    </div>
  );
}
