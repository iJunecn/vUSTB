'use client';

import { useState } from 'react';
import { Settings, Play, ChevronDown } from 'lucide-react';

type AccordionKey = 'desktop' | 'mobile' | null;

export default function CampusPage() {
  const [activeAccordion, setActiveAccordion] = useState<AccordionKey>(null);

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
            在浏览器中以第一视角探索像素重构的北科校园。使用键盘与鼠标自由移动，感受数字孪生的魅力。
          </p>

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <button
              disabled
              className="btn-ghost"
              style={{ borderRadius: '999px', opacity: 0.58, cursor: 'not-allowed' }}
            >
              <Play style={{ width: '14px', height: '14px' }} /> 进入画面
            </button>
            <button className="btn-ghost" style={{ borderRadius: '999px' }}>
              <Settings style={{ width: '14px', height: '14px' }} /> 引擎设置
            </button>
          </div>

          {/* Accordions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '18px' }}>
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
                <span>桌面端操作说明</span>
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
                  <li>W A S D 移动</li>
                  <li>鼠标转动视角</li>
                  <li>Space / Shift 升降</li>
                  <li>中键选择方块</li>
                  <li>右键放置方块</li>
                  <li>左键破坏方块</li>
                  <li>5 切换人称</li>
                  <li>Alt 唤起顶栏</li>
                  <li>X 打开引擎设置</li>
                  <li>Esc 退出操作态</li>
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
                  <li>左半屏拖动 移动</li>
                  <li>右半屏拖动 转向视角</li>
                  <li>右半屏单点 放置方块</li>
                  <li>右半屏长按 0.3s 破坏</li>
                  <li>左上按钮可选取方块</li>
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - 3D Engine Placeholder */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
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
            background: 'var(--color-background-mute)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            fontSize: '32px',
          }}>
            🏗️
          </div>
          <h2 style={{
            fontSize: '22px',
            fontWeight: 700,
            margin: '0 0 10px',
            color: 'var(--color-heading)',
          }}>
            3D 渲染引擎正在迁移中
          </h2>
          <p style={{
            margin: 0,
            color: 'var(--color-text-light)',
            lineHeight: 1.6,
            fontSize: '14px',
          }}>
            像素北科自研的 WebAssembly 渲染引擎正在迁移到新版网站，敬请期待。
          </p>
        </div>
      </div>
    </div>
  );
}
