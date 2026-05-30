import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Toaster } from 'sonner';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: '像素北科',
    template: '%s | 像素北科',
  },
  description:
    '像素北科 — 北京科技大学 Minecraft 数字校园社区',
  keywords: ['北京科技大学', 'USTB', 'Minecraft', '像素北科'],
  metadataBase: new URL('https://mc.ustb.edu.cn'),
  icons: {
    icon: '/img/logo.webp',
    shortcut: '/img/logo.webp',
    apple: '/img/logo.webp',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans min-h-screen flex flex-col`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
