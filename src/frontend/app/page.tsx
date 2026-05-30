'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';

type SiteSettings = {
  site_name?: string;
  site_title?: string;
  site_subtitle?: string;
};

export default function HomePage() {
  const [settings, setSettings] = useState<SiteSettings>({});
  const router = useRouter();

  useEffect(() => {
    api.get<SiteSettings>('/public/settings')
      .then((r) => setSettings(r.data))
      .catch(() => {});
  }, []);

  const siteName = settings.site_title || settings.site_name || '像素北科';

  function handleViewMore() {
    router.push('/about');
  }

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

      {/* Content — right side card */}
      <div className="home-content">
        <div className="home-card">
          <h1 className="home-card-title">{siteName}</h1>
          <p className="home-card-org">北京科技大学学生天码智能社</p>
          <p className="home-card-project">元宇宙体素工作坊代表项目</p>

          {/* 像素北科计划 */}
          <div className="home-card-block" style={{ borderLeftColor: '#2f78ba' }}>
            <h2 className="home-card-h2">像素北科计划</h2>
            <p className="home-card-p">
              像素北科计划是元宇宙体素工作坊发起的创意项目，通过体素化建模的形式将北科校园场景在 Minecraft 场景中复建。
            </p>
          </div>

          {/* 虚拟校园地图 */}
          <div className="home-card-block" style={{ borderLeftColor: '#22c55e' }}>
            <h3 className="home-card-h3">虚拟校园地图</h3>
            <p className="home-card-p">
              搭建完整的体素化校园服务器，在工作坊开发的&ldquo;立体智方&rdquo;智能体导游的带领下，云游北科校园。
            </p>
          </div>

          {/* 校园模型周边 */}
          <div className="home-card-block" style={{ borderLeftColor: '#eab308' }}>
            <h3 className="home-card-h3">校园模型周边</h3>
            <p className="home-card-p">
              对原有模型进行放大化体素打磨，制作体素化校园风景明信片、3D 打印模型等像素北科工程周边。
            </p>
          </div>

          {/* 加入交流群 */}
          <div className="home-card-block" style={{ borderLeftColor: '#a855f7' }}>
            <h2 className="home-card-h2">加入像素北科交流群</h2>
            <p className="home-card-p">
              <a
                target="_blank"
                href="https://qm.qq.com/cgi-bin/qm/qr?k=ija7cOnwjqzqwbep-3gmS-lQQtuYvjyv&jump_from=webapi&authKey=ZLoJ8z4ZFe2SdSeKluF/x6HW+R5+LFp/8PAvJud5dc2nCYtUx59saphFZx8LUW4w"
                rel="noreferrer"
              >
                <img
                  src="/img/qq.webp"
                  alt="像素北科交流群"
                  title="像素北科交流群"
                  style={{ verticalAlign: 'middle', marginRight: 6, borderRadius: 6, height: 24 }}
                />
                像素北科交流群
              </a>
            </p>
          </div>

          {/* 查看更多 */}
          <button
            type="button"
            onClick={handleViewMore}
            className="home-card-btn"
          >
            查看更多 <ArrowRight className="w-4 h-4" />
          </button>
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
