import Link from 'next/link';
import { ArrowLeft, Construction } from 'lucide-react';

export const metadata = {
  title: '3D 校园游览 - 像素北科',
};

export default function CampusPage() {
  return (
    <div className="container py-16 max-w-3xl">
      <div className="glass-card p-10 space-y-6 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
          <Construction className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold">3D 校园游览正在迁移中</h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          像素北科自研的 WebAssembly 渲染引擎正在迁移到新版网站。
          在那之前,你可以加入我们的 Minecraft 服务器,以第一视角探索像素北科校园。
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Link
            href="/servers"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
          >
            查看 MC 服务器
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl glass-card font-medium hover:bg-card transition"
          >
            <ArrowLeft className="w-4 h-4" /> 返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
