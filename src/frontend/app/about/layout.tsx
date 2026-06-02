import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '关于',
  description: '北京科技大学天码智能社介绍',
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
