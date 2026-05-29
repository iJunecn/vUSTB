export const metadata = {
  title: '往期活动 - 像素北科',
};

const ACTIVITIES = [
  {
    title: '像素北科 · 校园主体建造',
    date: '2024 - 2025',
    desc: '联合多位同学完成北科校园主要建筑的 1:1 像素重构,持续更新中。',
  },
  {
    title: '像素北科 · 新生季开服活动',
    date: '2024 秋季',
    desc: '面向北科 2024 级新生开放生存服与建造服,完成系列任务可获得限定皮肤。',
  },
  {
    title: '元宇宙体素工作坊招新',
    date: '常态化',
    desc: '欢迎对 MC、像素建造、3D 引擎、Web 开发感兴趣的北科同学加入。',
  },
];

export default function ActivitiesPage() {
  return (
    <div className="container py-16 space-y-8 max-w-4xl">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">往期活动</h1>
        <p className="text-muted-foreground">像素北科 / 元宇宙体素工作坊 的活动记录。</p>
      </header>

      <div className="space-y-4">
        {ACTIVITIES.map((a) => (
          <article key={a.title} className="glass-card p-6 space-y-2">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <h2 className="text-xl font-semibold">{a.title}</h2>
              <span className="text-sm text-muted-foreground">{a.date}</span>
            </div>
            <p className="text-muted-foreground">{a.desc}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
