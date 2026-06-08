'use client';

import { useState, lazy, Suspense } from 'react';
import { ChevronDown, Map, Lock } from 'lucide-react';

const CampusEngine = lazy(() =>
  import('@/components/campus/campus-engine').then((m) => ({ default: m.CampusEngine }))
);

type AccordionKey = 'desktop' | 'mobile' | 'legend' | null;


const CAMPUS_ENABLED = process.env.NEXT_PUBLIC_CAMPUS_ENABLED === 'true';
const MCA_BASE_URL = process.env.NEXT_PUBLIC_MCA_BASE_URL || '/resource/mca/ustb';
const RESOURCE_PACK_BASE_URL = process.env.NEXT_PUBLIC_RESOURCE_PACK_BASE_URL || '/packs';

export default function CampusPage() {
  const [activeAccordion, setActiveAccordion] = useState<AccordionKey>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [enableEngine, setEnableEngine] = useState(false);

  function toggleAccordion(key: AccordionKey) {
    setActiveAccordion((prev) => (prev === key ? null : key));
  }

  if (!CAMPUS_ENABLED && !enableEngine) {
    return (
      <div style={{
        minHeight: 'calc(100vh - 56px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'var(--color-background)',
      }}>
        <div className="glass-card" style={{
          padding: '40px',
          borderRadius: '24px',
          textAlign: 'center',
          maxWidth: '480px',
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '16px',
            background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <Map style={{ width: 32, height: 32, color: 'var(--color-primary)' }} />
          </div>
          <h2 style={{
            margin: '0 0 12px',
            fontSize: '24px',
            fontWeight: 700,
            color: 'var(--color-heading)',
          }}>
            在线校园游览
          </h2>
          <p style={{
            margin: '0 0 8px',
            color: 'var(--color-text-light)',
            lineHeight: 1.6,
            fontSize: '14px',
          }}>
            校园游览功能需要加载大量 Minecraft 存档数据与资源包，渲染时间较长。
          </p>
          <p style={{
            margin: '0 0 20px',
            color: 'var(--color-text-light)',
            lineHeight: 1.6,
            fontSize: '14px',
          }}>
            如需使用，请点击下方按钮手动启用。建议在性能较好的设备上使用。
          </p>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: '12px',
            background: 'color-mix(in srgb, #eab308 10%, transparent)',
            border: '1px solid color-mix(in srgb, #eab308 24%, transparent)',
            marginBottom: '16px',
            textAlign: 'left',
          }}>
            <Lock style={{ width: 16, height: 16, color: '#a16207', flexShrink: 0 }} />
            <span style={{ fontSize: '12px', color: '#a16207', lineHeight: 1.5 }}>
              需要 MCA 存档数据和资源包已正确部署到服务器，且浏览器支持 WebGL2 与 SharedArrayBuffer。
            </span>
          </div>
          <button
            onClick={() => setEnableEngine(true)}
            className="btn-primary"
            style={{ width: '100%' }}
          >
            启用校园游览
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="campus-layout">
      <div className="campus-panel">
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
            在浏览器中渲染 Minecraft 存档，探索像素重构的北科校园。使用鼠标旋转视角，滚轮缩放距离。
          </p>

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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
            <Accordion
              title="操作说明"
              isOpen={activeAccordion === 'desktop'}
              onToggle={() => toggleAccordion('desktop')}
            >
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
                <li>WASD 移动位置</li>
                <li>Space/Shift 升降</li>
              </ul>
            </Accordion>

            <Accordion
              title="移动端操作说明"
              isOpen={activeAccordion === 'mobile'}
              onToggle={() => toggleAccordion('mobile')}
            >
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
                <li>双指拖动 平移视角</li>
              </ul>
            </Accordion>

            <Accordion
              title="渲染引擎说明"
              isOpen={activeAccordion === 'legend'}
              onToggle={() => toggleAccordion('legend')}
            >
              <div style={{
                padding: '0 14px 14px',
                color: 'var(--color-text-light)',
                fontSize: '13px',
                lineHeight: 1.7,
              }}>
                <p style={{ margin: '0 0 8px' }}>
                  校园游览功能基于 Minecraft 存档文件（.mca）的浏览器端实时渲染。
                  引擎使用 WebGL2 技术加载和渲染体素世界数据。
                </p>
                <p style={{ margin: '0 0 8px' }}>
                  MCA 数据路径：<code style={{ color: 'var(--color-heading)', fontSize: '12px' }}>{MCA_BASE_URL}</code>
                </p>
                <p style={{ margin: 0 }}>
                  资源包路径：<code style={{ color: 'var(--color-heading)', fontSize: '12px' }}>{RESOURCE_PACK_BASE_URL}</code>
                </p>
              </div>
            </Accordion>
          </div>
        </div>
      </div>

      <div className="campus-canvas">
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
          <CampusEngine
            mcaBaseUrl={MCA_BASE_URL}
            onReady={() => setEngineReady(true)}
            onError={(msg) => console.error('[CampusPage] Engine error:', msg)}
          />
        </Suspense>
      </div>
    </div>
  );
}

function Accordion({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: '12px',
      overflow: 'hidden',
      background: isOpen ? 'var(--color-background-mute)' : 'var(--color-background-soft)',
      transition: 'background 0.2s ease',
    }}>
      <button
        type="button"
        onClick={onToggle}
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
        <span>{title}</span>
        <ChevronDown style={{
          width: '16px',
          height: '16px',
          transition: 'transform 0.2s ease',
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0)',
        }} />
      </button>
      {isOpen && children}
    </div>
  );
}
