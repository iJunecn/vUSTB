import Link from 'next/link';
import { ThemeToggle } from './theme-toggle';

const navItems = [
  { href: '/', label: '首页' },
  { href: '/servers', label: '服务器' },
  { href: '/skin', label: '皮肤站' },
  { href: '/campus', label: '校园游览' },
  { href: '/activities', label: '活动' },
  { href: '/about', label: '关于' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/60">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <span className="inline-block w-7 h-7 mc-gradient rounded-md pixel-shadow" />
          <span>
            像素北科 <span className="text-primary">vUSTB</span>
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="px-3 py-2 rounded-lg text-sm hover:bg-accent transition"
            >
              {it.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/login"
            className="hidden md:inline-flex px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
          >
            登录
          </Link>
        </div>
      </div>
    </header>
  );
}
