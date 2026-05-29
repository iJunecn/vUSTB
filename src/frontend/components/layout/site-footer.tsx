'use client';

import { usePathname } from 'next/navigation';

export function SiteFooter() {
  const pathname = usePathname();
  const isAuthPage = ['/login', '/register', '/reset-password'].includes(pathname);

  if (isAuthPage) return null;

  return (
    <footer className="mt-auto border-t" style={{ borderColor: 'var(--color-border)' }}>
      <div className="container py-6">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--color-text-light)' }}>
          <span>© {new Date().getFullYear()} 像素北科</span>
          <span className="hidden sm:inline">|</span>
          <a href="https://www.ustb.edu.cn/" target="_blank" rel="noreferrer" className="hover:underline">
            北京科技大学
          </a>
          <span className="hidden sm:inline">|</span>
          <a href="https://mc.sjtu.cn/" target="_blank" rel="noreferrer" className="hover:underline">
            SJTU Minecraft 社团
          </a>
        </div>
        <div className="mt-2 text-center text-xs" style={{ color: 'var(--color-text-light)' }}>
          Powered by <a href="https://github.com/LYOfficial/vSkin" target="_blank" rel="noreferrer" className="hover:underline">vSkin</a>
        </div>
      </div>
    </footer>
  );
}
