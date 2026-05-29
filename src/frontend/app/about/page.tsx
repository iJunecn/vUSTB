export const metadata = {
  title: '关于',
  description: '北京科技大学天码智能社介绍',
};

const DEPARTMENTS = [
  {
    kind: 'Tech',
    title: '技术部',
    description: '围绕 AI 技术研究与实践组织技术交流、研究小组和针对性培训，推动技术成果向实际应用转化。',
    spotlight: false,
  },
  {
    kind: 'Media',
    title: '媒体部',
    description: '负责社团品牌形象与活动传播，结合 AIGC 与数字媒体设计制作海报、视频等宣传材料。',
    spotlight: false,
  },
  {
    kind: 'Ops',
    title: '运营部',
    description: '承担社团日常行政、外联协调、成员档案和活动策划，是维持社团高效运转的中枢。',
    spotlight: false,
  },
  {
    kind: 'Core',
    title: '核心部（元宇宙体素工作坊）',
    description: '由"像素北科"发展成立，建设数字智能校园并引入多智能体交互，是社团最鲜明的项目型部门。',
    spotlight: true,
  },
];

const ABILITIES = [
  '体素校园建模与数字孪生表达',
  'Minecraft 服务器搭建与网络联机',
  '三维扫描识别与仿真环境工程建模',
  '红石逻辑、Prompt 工程与智能体调度交互',
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

export default function AboutPage() {
  return (
    <div style={{ maxWidth: '1120px', margin: '0 auto', padding: '40px 24px 60px' }}>
      {/* Hero Section */}
      <section style={{ marginBottom: '48px' }}>
        <p className="section-kicker" style={{ margin: '0 0 10px' }}>
          像素北科
        </p>
        <h1 style={{
          fontSize: 'clamp(36px, 5vw, 56px)',
          fontWeight: 900,
          lineHeight: 1.04,
          margin: '0 0 8px',
          color: 'var(--color-heading)',
          letterSpacing: '-0.02em',
        }}>
          天码智能社
        </h1>
        <p style={{
          fontSize: '18px',
          color: 'var(--color-text)',
          margin: '0 0 20px',
          lineHeight: 1.5,
        }}>
          以赛促学，以学促创，围绕 AI 前沿技术组织实践与项目协作
        </p>
        <p style={{
          color: 'var(--color-text-light)',
          lineHeight: 1.82,
          margin: '0 0 10px',
          maxWidth: '72ch',
        }}>
          天码智能社挂靠于智能科学与技术学院，秉承"智融实践，码筑未来"的宗旨，紧密围绕人工智能领域的前沿技术开展学习、交流与实践活动。社团从智能学院首个人工智能专业学习小组 Fusion Lab 发展而来，持续推动同学从兴趣入门走向项目实践、成果转化与长期协作。
        </p>
        <p style={{
          color: 'var(--color-text-light)',
          lineHeight: 1.82,
          margin: 0,
          maxWidth: '72ch',
        }}>
          这里既有技术培训，也有特色项目与社团活动。你可以从 AI 技术、AIGC 内容、活动组织、数字校园建设等不同方向进入，再逐步把个人兴趣接入一个更完整的智能科技社群。
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '14px',
          marginTop: '28px',
        }}>
          <div className="surface-card" style={{ padding: '18px' }}>
            <span className="section-kicker" style={{ display: 'block', marginBottom: '10px' }}>核心部门</span>
            <strong style={{ display: 'block', fontSize: '20px', color: 'var(--color-heading)', lineHeight: 1.24, marginBottom: '8px' }}>
              元宇宙体素工作坊
            </strong>
            <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '14px', lineHeight: 1.68 }}>
              以"像素北科"为代表，连接数字孪生、体素建模与多智能体交互，是社团最具辨识度的项目型部门。
            </p>
          </div>
          <div className="surface-card" style={{ padding: '18px' }}>
            <span className="section-kicker" style={{ display: 'block', marginBottom: '10px' }}>社团定位</span>
            <strong style={{ display: 'block', fontSize: '20px', color: 'var(--color-heading)', lineHeight: 1.24, marginBottom: '8px' }}>
              学院 AI 实践社团
            </strong>
            <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '14px', lineHeight: 1.68 }}>
              围绕智能技术、项目协作和成果展示构建持续运转的学习社区。
            </p>
          </div>
          <div className="surface-card" style={{ padding: '18px', background: 'var(--theme-accent-soft)' }}>
            <span className="section-kicker" style={{ display: 'block', marginBottom: '10px' }}>代表活动</span>
            <strong style={{ display: 'block', fontSize: '20px', color: 'var(--color-heading)', lineHeight: 1.24, marginBottom: '8px' }}>
              AI 秋令营 / 像素北科
            </strong>
            <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '14px', lineHeight: 1.68 }}>
              一类做系统化培训，一类做长期项目沉淀，形成社团特色内容。
            </p>
          </div>
        </div>
      </section>

      {/* Department Structure */}
      <section style={{ marginBottom: '48px' }}>
        <p className="section-kicker" style={{ margin: '0 0 8px' }}>部门结构</p>
        <h2 style={{
          fontSize: 'clamp(24px, 3.5vw, 34px)',
          fontWeight: 700,
          margin: '0 0 20px',
          color: 'var(--color-heading)',
          lineHeight: 1.14,
        }}>
          四个方向共同构成社团
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '16px',
        }}>
          {DEPARTMENTS.map((dept) => (
            <div
              key={dept.title}
              className="surface-card hoverable"
              style={{
                padding: '18px',
                background: dept.spotlight
                  ? 'linear-gradient(180deg, var(--theme-accent-soft), var(--color-card-background))'
                  : undefined,
              }}
            >
              <span style={{
                display: 'inline-flex',
                marginBottom: '12px',
                padding: '5px 9px',
                border: '1px solid var(--theme-border-strong)',
                borderRadius: '999px',
                background: 'var(--theme-accent-soft)',
                color: 'var(--theme-accent)',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>
                {dept.kind}
              </span>
              <h3 style={{
                margin: '0 0 8px',
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--color-heading)',
                lineHeight: 1.24,
              }}>
                {dept.title}
              </h3>
              <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '13px', lineHeight: 1.68 }}>
                {dept.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Core Department Detail */}
      <section style={{ marginBottom: '48px' }}>
        <p className="section-kicker" style={{ margin: '0 0 8px' }}>核心部门</p>
        <h2 style={{
          fontSize: 'clamp(24px, 3.5vw, 34px)',
          fontWeight: 700,
          margin: '0 0 20px',
          color: 'var(--color-heading)',
          lineHeight: 1.14,
        }}>
          元宇宙体素工作坊
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.16fr 0.84fr',
          gap: '18px',
          alignItems: 'start',
        }}>
          <div className="surface-card" style={{ padding: '22px' }}>
            <p style={{
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--color-text-light)',
              margin: '0 0 10px',
            }}>
              Featured Department
            </p>
            <h3 style={{
              fontSize: '18px',
              fontWeight: 600,
              margin: '0 0 14px',
              color: 'var(--color-heading)',
              lineHeight: 1.24,
            }}>
              以"像素北科"为核心，建设可以被浏览、交互和持续迭代的数字校园
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ margin: 0, color: 'var(--color-text-light)', lineHeight: 1.74 }}>
                元宇宙体素工作坊由社团品牌特色活动"像素北科"发展成立，旨在通过 Minecraft 建立 3D 数字智能校园，并在数字校园中引入虚拟具身多智能体等元素，实现元宇宙导航交互。它既是社团对外展示的亮点，也是一个真正持续推进的项目型部门。
              </p>
              <p style={{ margin: 0, color: 'var(--color-text-light)', lineHeight: 1.74 }}>
                工作坊前身来自学生自发组织的 USTB Servers 社区，因此既保留了沙盒平台的创造性，也逐步发展出数字孪生、空间交互和多智能体实验等更完整的工程表达。
              </p>
            </div>
            <div style={{
              marginTop: '18px',
              padding: '14px 16px',
              border: '1px solid var(--color-border)',
              borderRadius: '16px',
              background: 'var(--color-background-soft)',
            }}>
              <span style={{
                display: 'block',
                marginBottom: '8px',
                color: 'var(--color-text-light)',
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.1em',
              }}>
                项目关键词
              </span>
              <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '14px', lineHeight: 1.6 }}>
                数字校园 / 数字孪生 / 空间交互 / 多智能体实验
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div className="surface-card" style={{ padding: '20px' }}>
              <span style={{
                display: 'block',
                marginBottom: '10px',
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--color-text-light)',
              }}>
                项目能力
              </span>
              <ul style={{
                margin: '6px 0 0',
                paddingLeft: '18px',
                lineHeight: 1.7,
                color: 'var(--color-text-light)',
              }}>
                {ABILITIES.map((item) => (
                  <li key={item} style={{ marginTop: '10px' }}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="surface-card" style={{
              padding: '20px',
              background: 'linear-gradient(180deg, var(--theme-accent-soft), var(--color-card-background))',
            }}>
              <span style={{
                display: 'block',
                marginBottom: '10px',
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--color-text-light)',
              }}>
                展示出口
              </span>
              <h3 style={{
                fontSize: '18px',
                fontWeight: 600,
                margin: '0 0 8px',
                color: 'var(--color-heading)',
                lineHeight: 1.24,
              }}>
                百团大战 / 智能文化节 / VR 展示
              </h3>
              <p style={{ margin: 0, color: 'var(--color-text-light)', lineHeight: 1.74 }}>
                工作坊曾作为社团独特宣传出口在校内活动中广受关注，具有鲜明的学生创新特色。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Activities / Timeline Section */}
      <section id="activities">
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
