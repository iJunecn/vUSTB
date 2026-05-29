'use client';

import { useState, lazy, Suspense } from 'react';
import { Settings, Play, ChevronDown } from 'lucide-react';

const CampusCanvas = lazy(() =>
  import('@/components/campus/campus-canvas').then((m) => ({ default: m.CampusCanvas }))
);

type AccordionKey = 'desktop' | 'mobile' | null;

export default function CampusPage() {
  const [activeAccordion, setActiveAccordion] = useState<AccordionKey>(null);
  const [engineReady, setEngineReady] = useState(false);

  function toggleAccordion(key: AccordionKey) {
    setActiveAccordion((prev) => (prev === key ? null : key));
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      position: 'relative',
      background: 'var(--color-background)',
    }}>
      {/* HUD Panel - Left Side */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        width: 'min(420px, calc(100vw - 48px))',
        padding: '24px',
        flexShrink: 0,
      }}>
        <div className="glass-card" style={{
          padding: '22px',
          borderRadius: '24px',
        }}>
          <p className="section-kicker" style={{ margin: '0 0 8px' }}>
            Campus Explorer
          </p>
          <h2 style={{
            margin: '0 0 10px',
            fontSize: 'clamp(1.8rem, 2.8vw, 2.4rem)',
            lineHeight: 1.02,
            color: 'var(--color-heading)',
          }}>
            校园游览
          </h2>
          <p style={{
            margin: '0 0 18px',
            color: 'var(--color-text-light)',
            lineHeight: 1.6,
            fontSize: '14px',
          }}>
            在浏览器中以鸟瞰视角探索像素重构的北科校园。拖拽旋转视角，滚轮缩放距离。
          </p>

          {/* Status indicator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px',
            padding: '8px 12px',
            borderRadius: '999px',
            background: engineReady
              ? 'color-mix(in srgb, #22c55e 14%, transparent)'
              : 'color-mix(in srgb, #eab308 14%, transparent)',
            border: `1px solid ${engineReady
              ? 'color-mix(in srgb, #22c55e 28%, transparent)'
              : 'color-mix(in srgb, #eab308 28%, transparent)'}`,
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: engineReady ? '#22c55e' : '#eab308',
            }} />
            <span style={{
              fontSize: '12px',
              fontWeight: 600,
              color: engineReady ? '#198754' : '#a16207',
            }}>
              {engineReady ? '渲染引擎已就绪' : '渲染引擎加载中...'}
            </span>
          </div>

          {/* Accordions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
            {/* Desktop Controls Accordion */}
            <div style={{
              border: '1px solid var(--color-border)',
              borderRadius: '12px',
              overflow: 'hidden',
              background: activeAccordion === 'desktop' ? 'var(--color-background-mute)' : 'var(--color-background-soft)',
              transition: 'background 0.2s ease',
            }}>
              <button
                type="button"
                onClick={() => toggleAccordion('desktop')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '12px 14px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <span>操作说明</span>
                <ChevronDown style={{
                  width: '16px',
                  height: '16px',
                  transition: 'transform 0.2s ease',
                  transform: activeAccordion === 'desktop' ? 'rotate(180deg)' : 'rotate(0)',
                }} />
              </button>
              {activeAccordion === 'desktop' && (
                <ul style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '6px 14px',
                  margin: 0,
                  padding: '0 14px 14px',
                  listStyle: 'disc inside',
                  color: 'var(--color-text-light)',
                  fontSize: '14px',
                }}>
                  <li>鼠标拖拽 旋转视角</li>
                  <li>滚轮 缩放距离</li>
                  <li>鸟瞰全局视角</li>
                  <li>双击可重置视角</li>
                </ul>
              )}
            </div>

            {/* Mobile Controls Accordion */}
            <div style={{
              border: '1px solid var(--color-border)',
              borderRadius: '12px',
              overflow: 'hidden',
              background: activeAccordion === 'mobile' ? 'var(--color-background-mute)' : 'var(--color-background-soft)',
              transition: 'background 0.2s ease',
            }}>
              <button
                type="button"
                onClick={() => toggleAccordion('mobile')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '12px 14px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <span>移动端操作说明</span>
                <ChevronDown style={{
                  width: '16px',
                  height: '16px',
                  transition: 'transform 0.2s ease',
                  transform: activeAccordion === 'mobile' ? 'rotate(180deg)' : 'rotate(0)',
                }} />
              </button>
              {activeAccordion === 'mobile' && (
                <ul style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr',
                  gap: '6px',
                  margin: 0,
                  padding: '0 14px 14px',
                  listStyle: 'disc inside',
                  color: 'var(--color-text-light)',
                  fontSize: '14px',
                }}>
                  <li>单指拖动 旋转视角</li>
                  <li>双指缩放 调节距离</li>
                </ul>
              )}
            </div>

            {/* Buildings Legend */}
            <div style={{
              border: '1px solid var(--color-border)',
              borderRadius: '12px',
              overflow: 'hidden',
              background: activeAccordion === 'desktop' ? undefined : 'var(--color-background-soft)',
              transition: 'background 0.2s ease',
            }}>
              <button
                type="button"
                onClick={() => toggleAccordion('desktop')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '12px 14px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <span>校园建筑一览</span>
                <ChevronDown style={{
                  width: '16px',
                  height: '16px',
                  transition: 'transform 0.2s ease',
                  transform: activeAccordion === 'desktop' ? 'rotate(180deg)' : 'rotate(0)',
                }} />
              </button>
              {activeAccordion === 'desktop' && (
                <ul style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr',
                  gap: '4px',
                  margin: 0,
                  padding: '0 14px 14px',
                  listStyle: 'none',
                  color: 'var(--color-text-light)',
                  fontSize: '13px',
                }}>
                  <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#d4c5a9', flexShrink: 0 }} />
                    主楼
                  </li>
                  <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#c8b896', flexShrink: 0 }} />
                    机电信息楼 / 逸夫楼
                  </li>
                  <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#bfb08a', flexShrink: 0 }} />
                    科技楼 / 图书馆
                  </li>
                  <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#baa478', flexShrink: 0 }} />
                    计算机 / 材料学院楼
                  </li>
                  <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#b0996e', flexShrink: 0 }} />
                    学生公寓
                  </li>
                  <li style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#a89070', flexShrink: 0 }} />
                    校门
                  </li>
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - 3D Canvas */}
      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <Suspense
          fallback={
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              padding: '24px',
            }}>
              <div className="glass-card" style={{
                padding: '32px',
                borderRadius: '24px',
                textAlign: 'center',
                maxWidth: '400px',
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  border: '3px solid var(--color-primary)',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  margin: '0 auto 16px',
                  animation: 'spin 1s linear infinite',
                }} />
                <p style={{
                  margin: 0,
                  color: 'var(--color-text-light)',
                  fontSize: '14px',
                }}>
                  3D 引擎加载中...
                </p>
              </div>
            </div>
          }
        >
          <CampusCanvas onEngineReady={() => setEngineReady(true)} />
        </Suspense>
      </div>
    </div>
  );
}
