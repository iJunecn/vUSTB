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
    default: '像素北科 vUSTB | 北京科技大学元宇宙体素工作坊',
    template: '%s | 像素北科 vUSTB',
  },
  description:
    '北京科技大学元宇宙体素工作坊（vUSTB / 像素北科）官网。Minecraft 服务器、皮肤站、3D 校园游览与社区活动。',
  keywords: ['北京科技大学', 'USTB', 'Minecraft', '元宇宙', '体素', '像素北科', 'vUSTB'],
  metadataBase: new URL('https://mc.ustb.edu.cn'),
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
