import Link from 'next/link';
import { Library, Settings, Upload } from 'lucide-react';

export const metadata = {
  title: '皮肤站 - 像素北科',
};

export default function SkinHome() {
  return (
    <div className="container py-16 space-y-12 max-w-5xl">
      <header className="space-y-3">
        <span className="inline-block px-3 py-1 rounded-full bg-secondary/15 text-secondary text-sm font-medium">
          基于 Yggdrasil 协议 · authlib-injector 兼容
        </span>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          像素北科 皮肤站
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl">
          上传你的皮肤,绑定到 Minecraft 角色,通过 authlib-injector 在客户端中无缝使用,
          也可以浏览社区公共皮肤库。
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card href="/skin/library" icon={<Library />} title="皮肤库" desc="浏览社区上传的公共皮肤与披风。" />
        <Card href="/skin/upload" icon={<Upload />} title="上传皮肤" desc="把你的皮肤加入个人衣柜,或公开分享。" />
        <Card href="/skin/settings" icon={<Settings />} title="接入设置" desc="在 MC 客户端配置 authlib-injector。" />
      </div>
    </div>
  );
}

function Card({ href, icon, title, desc }: { href: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link href={href} className="glass-card p-6 hover:border-primary/50 transition group space-y-3">
      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
        {icon}
      </div>
      <h3 className="text-lg font-semibold group-hover:text-primary transition">{title}</h3>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </Link>
  );
}
