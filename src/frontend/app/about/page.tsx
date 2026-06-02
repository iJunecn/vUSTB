'use client';

import { useState } from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';

const DEPARTMENTS = [
  {
    kind: 'Tech',
    title: '技术部',
    description: '围绕 AI 技术研究与实践组织技术交流、研究小组和针对性培训，推动技术成果向实际应用转化。',
    spotlight: false,
  },
  {
    kind: 'Media',
    title: '宣传部',
    description: '负责社团品牌形象与活动传播，结合 AIGC 与数字媒体设计制作海报、视频等宣传材料。',
    spotlight: false,
  },
  {
    kind: 'Office',
    title: '办公室',
    description: '承担社团日常行政、外联协调、成员档案和活动策划，是维持社团高效运转的中枢。',
    spotlight: false,
  },
  {
    kind: 'Core',
    title: '工作坊',
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

const TIMELINE = [
  { date: '2023.5', text: '开始规划人工智能实验室（社团）', detail: '智能科学与技术学院创新创业中心提出了关于人工智能实验室（社团）发展规划（初步）。' },
  { date: '2023.9', text: '完成人工智能社团（实验室）建设初期规划', detail: '在初步规划基础上进行初代人员招募，开展培训等相关活动。' },
  { date: '2024.3', text: '新社团成立答辩', detail: '在21级学生的努力下，人工智能社团通过答辩并进入考察期，社团名称正式定为"天码智能社"。' },
  { date: '2024.4', text: '各种立项活动初办', detail: '社团注册后，22级成员逐步开始进行各类活动初办尝试，如"AIGC科普课程"、"第一届智能文化节"等。' },
  { date: '2024.9', text: '提出AI+MC方向团队建设方案', detail: '22级与23级根据活跃人员兴趣情况，提出社团内北科Minecraft方向研究团队的建设设想。' },
  { date: '2024.10', text: '首届天码智能秋令营成功举办', detail: '在23级带领下，社团开展对外的大型培训活动"天玛秋令营"，并为优秀学员颁发证书。' },
  { date: '2024.10', text: '第一次装修地下室', detail: '社团部正式为社团分配了1斋地下活动室B123作为活动场地，社团部分工作人员开始装修。' },
  { date: '2024.12', text: '"立体智方"团队获奖', detail: '"立体智方"团队在摇篮杯创意竞赛上首次将MC智能体搬上北科校内比赛，获校级一等奖。' },
  { date: '2025.3', text: '开办活动"元宇宙体素工作坊"', detail: '以比赛经历为经验，重新规划了未来社团布局，筹备创立了"AI+MC"方向团队"元宇宙体素工作坊"。' },
  { date: '2025.7', text: '"像素北科"工程启动', detail: '以在Minecraft中还原北科的"像素北科"项目正式启动，服务器面向社团开放。' },
  { date: '2025.10', text: '成立部门"元宇宙体素工作坊"', detail: '"元宇宙体素工作坊"由特色活动升级为社团部门，原活动更名"像素北科"并进一步发展。' },
  { date: '2026.4', text: '第一次社团大会', detail: '成立三年，天码智能社第一次召开全社迎新大会，推动社团走向新的未来。' },
  { date: '2026.6', text: '像素北科官网改造升级', detail: '像素北科项目获批校内虚拟服务器，合并各平台，改造升级新官网。' },
];

const ARCHIVE_ITEMS = [
  {
    type: 'Brand Project',
    title: '3月 百团大战',
    date: '2024 - 2026',
    description: '百团大战是校一年一度的社团招新活动，于每年春季举办，社团会在纳新期间推出有趣的社团活动，并制作大量社团周边用于活动赠送，活动摊位前人流量不断，观众参与活动情绪高涨，为社团的宣传做出了突出贡献。',
  },
  {
    type: 'College Showcase',
    title: '4月 智能文化节',
    date: '2024 - 2026',
    description: '智能文化节是智能学院主办的AI文化宣传活动，通过一个个项目展示摊位展现智能学子的科创风采。天码智能社的"像素北科"项目也曾结合VR技术在摊位进行展出，吸引了很多学生及家属区儿童的关注和参与。',
  },
  {
    type: 'Training',
    title: '5月 智能科普培训挑战赛',
    date: '2024 - 2026',
    description: '由原来的"AIGC 科普课程"转化而来，紧跟时代趋势，探索 Vibe Coding 单人项目速成，鼓励大家将自己的想法转变成真实的项目，并为参赛选手提供 Coding Plan 和算力资源。',
  },
  {
    type: 'Training',
    title: '10月 天码智能秋令营',
    date: '2024 - 2026',
    description: '天码智能社AI秋令营为社团及智能学院的特色培训项目，联合多个科技社团组织大型社团培训活动，面向全校本科生展开，经过两个月左右的培训，带大家从零走入AIGC应用的大门。',
  },
  {
    type: 'Competition',
    title: '11月 智能引擎',
    date: '2024 - 2026',
    description: '智能引擎辅助"摇篮杯创意竞赛"开展创意培训，旨在从零带参与同学培养创新意识，了解创新比赛，能够有一定能力参与各类创新活动和比赛，同时也为获奖同学颁发奖品。',
  },
  {
    type: 'Brand Project',
    title: '长期 像素北科',
    date: '2025 - 至今',
    description: '作为学院和社团最新兴起也最热门的项目，"像素北科"由"元宇宙体素工作坊"负责，组织通过数字孪生技术，使用沙盒游戏Minecraft建设体素化的电子北科校园，并以此项目展开相关特色活动，也是社团招新的一大亮点。',
  },
];

/* ---- Letter modal content (方块里的北科) ---- */

const LETTER_IMAGES = [
  { src: '/img/skycode/0.png', alt: '像素北科早期' },
  { src: '/img/skycode/1.png', alt: 'MC兴趣群' },
  { src: '/img/skycode/2.png', alt: '立体智方项目' },
  { src: '/img/skycode/3.png', alt: '其他高校体素化' },
  { src: '/img/skycode/5.png', alt: '像素北科工作流' },
  { src: '/img/skycode/6.png', alt: '白模上色成果' },
  { src: '/img/skycode/7.png', alt: '3D打印文创' },
];

export default function AboutPage() {
  const [letterOpen, setLetterOpen] = useState(false);

  return (
    <div style={{ maxWidth: '1120px', margin: '0 auto', padding: '40px 24px 60px' }}>
      {/* Hero Section */}
      <section style={{ marginBottom: '48px' }}>
        <p className="section-kicker" style={{ margin: '0 0 10px' }}>
          「像素北科」项目发起方
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
          以赛促学，以学促创，围绕 AI 前沿技术组织实践与项目协作的「学术科技类」社团
        </p>
        <p style={{
          color: 'var(--color-text-light)',
          lineHeight: 1.82,
          margin: '0 0 10px',
          maxWidth: '72ch',
        }}>
          天码智能社挂靠于北京科技大学人工智能学院，秉承"智融实践，码筑未来"的宗旨，紧密围绕人工智能领域的前沿技术，以赛促学，以学促创，积极营造浓厚的学术氛围，打造了一系列精品活动，为培养具有创新精神、实践能力和社会责任感的智能科技人才贡献力量。
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
              学术科技类社团
            </strong>
            <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '14px', lineHeight: 1.68 }}>
              围绕智能技术培训、项目协作和成果展示构建持续运转的学习社区。
            </p>
          </div>
          <div className="surface-card" style={{ padding: '18px' }}>
            <span className="section-kicker" style={{ display: 'block', marginBottom: '10px' }}>代表活动</span>
            <strong style={{ display: 'block', fontSize: '20px', color: 'var(--color-heading)', lineHeight: 1.24, marginBottom: '8px' }}>
              天码智能秋令营
            </strong>
            <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '14px', lineHeight: 1.68 }}>
              社团招牌活动，以<strong>科普</strong>和<strong>实践</strong>带学员走进<strong>AI生成与应用</strong>领域的大门。
            </p>
          </div>
          <div className="surface-card" style={{ padding: '18px', background: 'var(--theme-accent-soft)', cursor: 'pointer' }} onClick={() => setLetterOpen(true)}>
            <span className="section-kicker" style={{ display: 'block', marginBottom: '10px' }}>代表活动</span>
            <strong style={{ display: 'block', fontSize: '20px', color: 'var(--color-primary)', lineHeight: 1.24, marginBottom: '8px', textDecoration: 'underline', textUnderlineOffset: 3 }}>
              像素北科
            </strong>
            <p style={{ margin: 0, color: 'var(--color-text-light)', fontSize: '14px', lineHeight: 1.68 }}>
              社团特色活动，以<strong>体素</strong>为<strong>砖</strong>，以<strong>创意</strong>为<strong>图</strong>，在Minecraft中构建体素校园。
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
          margin: '0 0 8px',
          color: 'var(--color-heading)',
          lineHeight: 1.14,
        }}>
          元宇宙体素工作坊
        </h2>
        <p style={{
          fontSize: '14px',
          color: 'var(--color-text-light)',
          margin: '0 0 20px',
          fontStyle: 'italic',
        }}>
          USTB Metaverse Voxel Workshop
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.16fr 0.84fr',
          gap: '18px',
          alignItems: 'start',
        }}>
          <div className="surface-card" style={{ padding: '22px' }}>
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
                数字校园 / 数字孪生 / 空间交互 / 多智能体交互
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
                百团大战 / 智能文化节 / 游园开放日
              </h3>
              <p style={{ margin: 0, color: 'var(--color-text-light)', lineHeight: 1.74 }}>
                工作坊曾作为社团独特宣传出口在校内活动中广受关注，具有鲜明的学生创新特色。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Development Timeline */}
      <section style={{ marginBottom: '48px' }}>
        <p className="section-kicker" style={{ margin: '0 0 8px' }}>发展时间线</p>
        <h2 style={{
          fontSize: 'clamp(24px, 3.5vw, 34px)',
          fontWeight: 700,
          margin: '0 0 24px',
          color: 'var(--color-heading)',
          lineHeight: 1.14,
        }}>
          发展时间线
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
          {TIMELINE.map((item, idx) => (
            <article
              key={idx}
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
                    fontSize: '13px',
                    fontWeight: 700,
                    color: 'var(--color-primary)',
                  }}>
                    {item.date}
                  </span>
                </div>
                <h3 style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  margin: '0 0 6px',
                  color: 'var(--color-heading)',
                  lineHeight: 1.24,
                }}>
                  {item.text}
                </h3>
                <p style={{ margin: 0, color: 'var(--color-text-light)', lineHeight: 1.74 }}>
                  {item.detail}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Activities / Archive Section */}
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

      {/* ====== Letter Modal: 方块里的北科 ====== */}
      {letterOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setLetterOpen(false); }}
        >
          <div
            style={{
              background: 'var(--color-card-background)', borderRadius: 16, maxWidth: 640, width: '100%',
              maxHeight: '85vh', overflowY: 'auto',
              boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
              animation: 'slideUp 0.3s ease-out',
            }}
          >
            {/* Header */}
            <div style={{
              position: 'sticky', top: 0, zIndex: 1,
              background: 'var(--color-card-background)',
              borderBottom: '1px solid var(--color-border)',
              padding: '16px 20px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-heading)' }}>
                方块里的北科
              </h2>
              <button onClick={() => setLetterOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--color-text-light)' }}>
                <X style={{ width: 20, height: 20 }} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '24px 28px', fontSize: 15, color: 'var(--color-text)', lineHeight: 1.85 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 20px', color: 'var(--color-heading)' }}>
                方块里的北科——一个名为像素北科的故事
              </h3>

              <p style={{ margin: '0 0 16px' }}>
                大家好，我是天码智能社第三届团支书刘粤，很荣幸今天在这里给大家分享一个故事，一个名为像素北科的故事。
              </p>

              <p style={{ margin: '0 0 16px' }}>
                三年前，我刚进入北科校园，本身对Minecraft感兴趣的我，机缘巧合下加入了北科的MC兴趣群，得知这里的同好们跟我有这一个共同的目标，想要把北科的校园以体素化的形式在3D游戏里复原，但是苦于各种原因无法进一步推进工程发展，已有的工程还在原地搁置。
              </p>

              <div style={{ margin: '0 0 16px', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
                <Image src={LETTER_IMAGES[0].src} alt={LETTER_IMAGES[0].alt} width={640} height={360} style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>

              <p style={{ margin: '0 0 16px' }}>
                于此同时，我也在群里结识了智能学院天码智能社上一任的社长，同样作为MC爱好者，我们就想，能否将我们的兴趣与AI相结合，发挥我们兴趣的主观能动性与AI这种社团及学院优势，在人工智能学院推出一个"AI+MC"的项目，并在学院里招募学生打造一个团队，来一起做这个事情。
              </p>

              <div style={{ margin: '0 0 16px', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
                <Image src={LETTER_IMAGES[1].src} alt={LETTER_IMAGES[1].alt} width={640} height={360} style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>

              <p style={{ margin: '0 0 16px' }}>
                之后恰逢学校SRTP立项，我依托学院实验室创立了一个项目，取名为"立体智方"，我们搭建了一个"三步一体"的沟通架构，实现了客户端、服务端与智能体的实时响应，集成了AI对环境的感知与行为控制和兴趣预设，将大模型接入了这款游戏，实现了一个智能体导游带领玩家畅游世界，一边走一边介绍，同时还能回答玩家的问题，实现多人一起在智能体导游的带领下"云游览"。
              </p>

              <div style={{ margin: '0 0 16px', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
                <Image src={LETTER_IMAGES[2].src} alt={LETTER_IMAGES[2].alt} width={640} height={360} style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>

              <p style={{ margin: '0 0 16px' }}>
                这个项目也取得了一些竞赛的优异成绩，我们也带着这个项目走上了更广的舞台，让更多人认识我们的项目。
              </p>

              <p style={{ margin: '0 0 16px' }}>
                有了导游，但是游玩的地图还是未能解决。于是我们带着项目来到天码智能社，构建起一个新的社团部门"元宇宙体素工作坊"，目标是将整个北科，以及各个分校区，包括正在兴建的雄安校区，全部在3D环境中建造出来，最终实现我们的智能体导游代领大家云游北科。
              </p>

              <p style={{ margin: '0 0 16px' }}>
                校园体素化呢，其实很早就有了，很多高校学生正在以这种体素化的方式还原自己的大学校园，邀请大家前来参观。
              </p>

              <p style={{ margin: '0 0 16px' }}>
                央视网、共青团中央曾与多校合作，发布宣传视频，展示各个高校风采，这种受年轻人喜爱的方式也成为高校宣传的一大手段。
              </p>

              <p style={{ margin: '0 0 16px' }}>
                但是由于我们建模能力不足，人力也不是很充足，难以在短时间内完成，这么多建筑复建，于是我们就在想，导游，我们能结合AI做出来，那能不能再发挥一下我们智能社团的优势，让AI来推动我们的体素化建造呢？
              </p>

              <div style={{ margin: '0 0 16px', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
                <Image src={LETTER_IMAGES[3].src} alt={LETTER_IMAGES[3].alt} width={640} height={360} style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>

              <p style={{ margin: '0 0 16px' }}>
                于是在我们的努力下，借助北科在线校园地图，我们构建出了一个从地图图片到体素模型的工作流，我们命名为"像素北科"，从此，我们的工程进展迎来了一个大飞跃。
              </p>

              <p style={{ margin: '0 0 16px' }}>
                我们借助ComfyUI稳定扩散管道，将各个模块相连，构建出了一个完整的多模型全自动工作流，现在只需要在校园地图上截取一张图，放入工作流之中，加载本地部署各种模型，然后点击一下"运行"，我们会先通过提示词工程来调用大模型去除背景杂色，生成纯色底图，再调用3D模型将平面映射到三维，我们就可以生成一个完整的建筑白模了。
              </p>

              <div style={{ margin: '0 0 16px', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
                <Image src={LETTER_IMAGES[4].src} alt={LETTER_IMAGES[4].alt} width={640} height={360} style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>

              <p style={{ margin: '0 0 16px' }}>
                而这种白膜一般是不能直接用的，我们体素化之后，便可用于后期加工和上色，便可以完成整个北科校园的建造。同时时间上也实现了三个月到一小时的飞跃，大大减少了人力。
              </p>

              <div style={{ margin: '0 0 16px', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
                <Image src={LETTER_IMAGES[5].src} alt={LETTER_IMAGES[5].alt} width={640} height={360} style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>

              <p style={{ margin: '0 0 16px' }}>
                与此同时，我们上色后的建筑模型也可以制作成明信片和3D打印模型文创，有趣的是，我们在游戏里做建筑是用方块形式层层相叠，而3D打印的形式也是层层叠起，制作过程和建造过程相符相合，也是我们体素化制作模型的一大优势。
              </p>

              <div style={{ margin: '0 0 16px', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
                <Image src={LETTER_IMAGES[6].src} alt={LETTER_IMAGES[6].alt} width={640} height={360} style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>

              <p style={{ margin: '0 0 16px' }}>
                目前，我们的项目已稳定部署，工程进展正在推进，我们希望，不久的将来，我们可以把北科校园，以及心向往之的雄安校区，带到3D游戏中，可以在智能体导游的带领下，向朋友，向家人，向校友，向正在备战高考的高中生们，向所有对北科感兴趣的人，介绍我们的北京科技大学！
              </p>

              <p style={{ margin: '0 0 8px' }}>
                谢谢大家！
              </p>

              <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--color-border)', color: 'var(--color-text-light)', fontSize: 13 }}>
                <p style={{ margin: '0 0 4px' }}>2026年4月30日</p>
                <p style={{ margin: 0 }}>北京科技大学教职工礼堂</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
