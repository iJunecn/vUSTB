import Link from 'next/link';
import { ArrowRight, Server, Palette, Map, Users } from 'lucide-react';

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 mc-gradient opacity-10" />
        <div className="container relative py-24 md:py-32">
          <div className="flex flex-col items-center text-center space-y-6">
            <span className="inline-block px-4 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
              北京科技大学元宇宙体素工作坊
            </span>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight">
              像素北科 <span className="text-primary">vUSTB</span>
            </h1>
            <p className="max-w-2xl text-lg md:text-xl text-muted-foreground">
              用 Minecraft 重构校园，用体素重塑想象。一个面向北科学子的 MC 服务器、皮肤站与 3D 校园元宇宙。
            </p>
            <div className="flex flex-wrap gap-3 justify-center pt-4">
              <Link
                href="/servers"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
              >
                查看服务器 <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/skin"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl glass-card font-medium hover:bg-card transition"
              >
                进入皮肤站
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="container py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <FeatureCard
            href="/servers"
            icon={<Server className="w-8 h-8 text-primary" />}
            title="MC 服务器"
            desc="生存、创造、像素北科主世界，实时在线状态。"
          />
          <FeatureCard
            href="/skin"
            icon={<Palette className="w-8 h-8 text-secondary" />}
            title="皮肤站"
            desc="完整支持 authlib-injector，自定义皮肤与披风。"
          />
          <FeatureCard
            href="/campus"
            icon={<Map className="w-8 h-8 text-mc-diamond" />}
            title="3D 校园游览"
            desc="像素重建北科校园，浏览器即可漫游。"
          />
          <FeatureCard
            href="/about"
            icon={<Users className="w-8 h-8 text-mc-pixel" />}
            title="加入我们"
            desc="了解元宇宙体素工作坊，成为像素北科的一员。"
          />
        </div>
      </section>
    </>
  );
}

function FeatureCard({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="glass-card p-6 hover:scale-[1.02] hover:border-primary/50 transition-all group"
    >
      <div className="mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2 group-hover:text-primary transition">{title}</h3>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </Link>
  );
}
