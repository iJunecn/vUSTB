import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 mt-16">
      <div className="container py-10 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <div className="flex items-center gap-2 font-bold text-lg mb-3">
            <span className="inline-block w-6 h-6 mc-gradient rounded-md" />
            像素北科 vUSTB
          </div>
          <p className="text-sm text-muted-foreground">
            北京科技大学元宇宙体素工作坊。用 Minecraft 重构校园，用体素重塑想象。
          </p>
        </div>
        <div>
          <h4 className="font-semibold mb-3">站点</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link href="/servers" className="hover:text-primary">MC 服务器</Link></li>
            <li><Link href="/skin" className="hover:text-primary">皮肤站</Link></li>
            <li><Link href="/campus" className="hover:text-primary">3D 校园游览</Link></li>
            <li><Link href="/about" className="hover:text-primary">关于工作坊</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold mb-3">友情链接</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><a href="https://mc.sjtu.cn/" target="_blank" rel="noreferrer" className="hover:text-primary">SJTU Minecraft 社团</a></li>
            <li><a href="https://www.ustb.edu.cn/" target="_blank" rel="noreferrer" className="hover:text-primary">北京科技大学</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/60 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} 像素北科 vUSTB · 北京科技大学元宇宙体素工作坊 · GPL-3.0
      </div>
    </footer>
  );
}
