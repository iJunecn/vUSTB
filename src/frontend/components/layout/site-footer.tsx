'use client';

import { usePathname } from 'next/navigation';

export function SiteFooter() {
  const pathname = usePathname();
  const isAuthPage = ['/login', '/register', '/reset-password'].includes(pathname);
  const isHome = pathname === '/';
  const isServers = pathname === '/servers';

  if (isAuthPage || isHome || isServers) return null;

  return (
    <footer className="mt-auto border-t" style={{ borderColor: 'var(--color-border)' }}>
      <div className="container py-4">
        <p className="text-center text-xs" style={{ color: 'var(--color-text-light)' }}>
          北京科技大学学生天码智能社 &copy; {new Date().getFullYear()} 像素北科
        </p>
      </div>
    </footer>
  );
}
