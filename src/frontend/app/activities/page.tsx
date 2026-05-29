export const metadata = {
  title: '往期活动 - 像素北科',
};

const SUMMARY_CARDS = [
  {
    label: '代表性培训',
    title: 'AI 秋令营',
    description: '以两个月左右的课程和实践组织 AI 入门、AIGC 和工程项目体验。',
  },
  {
    label: '特色项目展示',
    title: '像素北科',
    description: '依托元宇宙体素工作坊，让数字孪生校园成为对外展示的核心亮点。',
  },
  {
    label: '校内活动',
    title: '百团大战 / 智能文化节',
    description: '将社团技术、作品与互动体验带到线下场景，形成持续传播和招新入口。',
  },
];

const ARCHIVE_ITEMS = [
  {
    type: 'Brand Project',
    title: '像素北科',
    date: '2024 - 2025',
    description: '由元宇宙体素工作坊负责，使用 Minecraft 建设体素化电子北科校园，并结合数字孪生技术开展特色活动。联合多位同学完成北科校园主要建筑的 1:1 像素重构，持续更新中。',
  },
  {
    type: 'Campus Recruitment',
    title: '百团大战',
    date: '每年春季',
    description: '每年春季的重要招新活动。社团会策划互动体验、准备周边和特色展示，为社团传播带来持续曝光。',
  },
  {
    type: 'College Showcase',
    title: '智能文化节',
    date: '2024 秋季',
    description: '由智能科学与技术学院主办的 AI 文化宣传活动，像素北科项目曾结合 VR 技术在摊位展出，吸引大量关注。',
  },
  {
    type: 'Training',
    title: 'AI 秋令营',
    date: '2024 秋季',
    description: '社团代表性培训项目，围绕 LLM 应用、AIGC 图像生成与像素北科工程实践三条 Track，组织连续两个月左右的训练路径。',
  },
  {
    type: 'Orientation',
    title: '新生季开服活动',
    date: '2024 秋季',
    description: '面向北科 2024 级新生开放生存服与建造服，完成系列任务可获得限定皮肤。',
  },
  {
    type: 'Recruitment',
    title: '元宇宙体素工作坊招新',
    date: '常态化',
    description: '欢迎对 MC、像素建造、3D 引擎、Web 开发感兴趣的北科同学加入。',
  },
];

export default function ActivitiesPage() {
  return (
    <div style={{ maxWidth: '1120px', margin: '0 auto', padding: '40px 24px 60px' }}>
      {/* Hero Section */}
      <section style={{ marginBottom: '40px' }}>
        <p className="section-kicker" style={{ margin: '0 0 10px' }}>Activity Archive</p>
        <h1 style={{
          fontSize: 'clamp(32px, 5vw, 52px)',
          fontWeight: 900,
          lineHeight: 1.04,
          margin: '0 0 10px',
          color: 'var(--color-heading)',
        }}>
          往期活动
        </h1>
        <p style={{
          fontSize: '16px',
          color: 'var(--color-text-light)',
          margin: '0 0 28px',
          maxWidth: '68ch',
          lineHeight: 1.74,
        }}>
          社团代表性培训、展示与经典活动归档。天码智能社的活动并不只服务于一次报名或一次摆摊，它们共同构成了社团的成长轨迹。
        </p>

        {/* Summary Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '14px',
        }}>
          {SUMMARY_CARDS.map((card, idx) => (
            <div
              key={card.title}
              className="surface-card"
              style={{
                padding: '18px',
                background: idx === 2
                  ? 'linear-gradient(180deg, var(--theme-accent-soft), var(--color-card-background))'
                  : undefined,
              }}
            >
              <span className="section-kicker" style={{ display: 'block', marginBottom: '10px' }}>
                {card.label}
              </span>
              <strong style={{
                display: 'block',
                fontSize: '20px',
                color: 'var(--color-heading)',
                lineHeight: 1.24,
                marginBottom: '8px',
              }}>
                {card.title}
              </strong>
              <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '14px', lineHeight: 1.68 }}>
                {card.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Timeline Section */}
      <section>
        <p className="section-kicker" style={{ margin: '0 0 8px' }}>活动归档</p>
        <h2 style={{
          fontSize: 'clamp(24px, 3.5vw, 34px)',
          fontWeight: 700,
          margin: '0 0 24px',
          color: 'var(--color-heading)',
          lineHeight: 1.14,
        }}>
          往期活动
        </h2>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          position: 'relative',
          paddingLeft: '24px',
        }}>
          {/* Timeline vertical line */}
          <div style={{
            position: 'absolute',
            left: '5px',
            top: '8px',
            bottom: '8px',
            width: '2px',
            background: 'linear-gradient(180deg, var(--color-primary), var(--color-border))',
            borderRadius: '1px',
          }} />

          {ARCHIVE_ITEMS.map((item) => (
            <article
              key={item.title}
              className="surface-card"
              style={{
                display: 'grid',
                gridTemplateColumns: '12px 1fr',
                gap: '14px',
                padding: '18px',
                alignItems: 'start',
              }}
            >
              {/* Timeline dot */}
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: 'var(--color-primary)',
                border: '2px solid var(--color-card-background)',
                boxShadow: '0 0 0 2px var(--color-primary)',
                marginTop: '4px',
              }} />
              <div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  flexWrap: 'wrap',
                  marginBottom: '6px',
                }}>
                  <span style={{
                    display: 'inline-flex',
                    padding: '4px 9px',
                    border: '1px solid var(--theme-border-strong)',
                    borderRadius: '999px',
                    background: 'var(--theme-accent-soft)',
                    color: 'var(--theme-accent)',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}>
                    {item.type}
                  </span>
                  <span style={{
                    fontSize: '13px',
                    color: 'var(--color-text-light)',
                  }}>
                    {item.date}
                  </span>
                </div>
                <h3 style={{
                  fontSize: '20px',
                  fontWeight: 600,
                  margin: '0 0 6px',
                  color: 'var(--color-heading)',
                  lineHeight: 1.24,
                }}>
                  {item.title}
                </h3>
                <p style={{ margin: 0, color: 'var(--color-text-light)', lineHeight: 1.74 }}>
                  {item.description}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
