export const metadata = {
  title: '关于 - 像素北科 vUSTB',
  description: '北京科技大学元宇宙体素工作坊介绍',
};

export default function AboutPage() {
  return (
    <div className="container py-16 space-y-12 max-w-4xl">
      <header className="space-y-3">
        <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
          关于我们
        </span>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          北京科技大学<br />元宇宙体素工作坊
        </h1>
        <p className="text-lg text-muted-foreground">
          英文名 <b className="text-foreground">vUSTB</b>，中文名 <b className="text-foreground">像素北科</b>。
          我们以 Minecraft 为载体，用体素重构北科校园,搭建一个属于北科学子的元宇宙空间。
        </p>
      </header>

      <section className="glass-card p-8 space-y-4">
        <h2 className="text-2xl font-semibold">我们做什么</h2>
        <ul className="space-y-3 text-muted-foreground">
          <li>
            <b className="text-foreground">运营 MC 服务器：</b>
            生存、创造、像素北科校园主世界,为北科师生提供稳定可访问的 Minecraft 体验。
          </li>
          <li>
            <b className="text-foreground">皮肤站（基于 Yggdrasil 协议）：</b>
            完整支持 authlib-injector,用户可上传/管理自己的皮肤与披风,绑定到任意角色。
          </li>
          <li>
            <b className="text-foreground">3D 校园游览：</b>
            自研基于 WebAssembly 的渲染引擎,将像素重构的北科校园直接呈现到浏览器中。
          </li>
          <li>
            <b className="text-foreground">活动与创作：</b>
            举办建造比赛、像素艺术展览,沉淀工作坊作品集。
          </li>
        </ul>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-card p-6 space-y-2">
          <h3 className="text-xl font-semibold">技术栈</h3>
          <p className="text-sm text-muted-foreground">
            Next.js + FastAPI + PostgreSQL + Yggdrasil 协议,全部开源、可自部署。
          </p>
        </div>
        <div className="glass-card p-6 space-y-2">
          <h3 className="text-xl font-semibold">加入我们</h3>
          <p className="text-sm text-muted-foreground">
            北科在校师生均可加入,无论是建造、编程、美术、运营,我们都欢迎你。
          </p>
        </div>
      </section>
    </div>
  );
}
