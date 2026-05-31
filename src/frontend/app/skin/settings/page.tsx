'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Copy, Check, Terminal, MonitorSmartphone, Server, MousePointerClick, Loader2 } from 'lucide-react';

export default function SkinSettingsPage() {
  const [origin, setOrigin] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    (async () => {
      try {
        const r = await api.get<{ public_url?: string }>('/public/settings');
        setPublicUrl((r.data.public_url || '').replace(/\/$/, ''));
      } catch {
        // ignore — fall back to window.location.origin
      } finally {
        setLoadingSettings(false);
      }
    })();
  }, []);

  const base = (publicUrl || origin).replace(/\/$/, '');
  const apiUrl = `${base}/skinapi/`;
  const dragHref = `authlib-injector:yggdrasil-server:${encodeURIComponent(apiUrl)}`;
  const launchArg = `-javaagent:authlib-injector.jar=${apiUrl}`;

  async function copy(key: string, value: string) {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        ok = true;
      }
    } catch {
      // fall through to legacy fallback
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.left = '-1000px';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, value.length);
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } else {
      window.prompt('请手动复制：', value);
    }
  }

  if (loadingSettings) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-text-light)' }} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>SETUP</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          快速配置启动器
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
          像素北科皮肤站完整实现 Yggdrasil 协议，可在任意支持 authlib-injector 的 Minecraft 启动器中使用。
        </p>
      </div>

      {/* Drag to launcher + API copy */}
      <div className="surface-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Terminal style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
            一键接入
          </h2>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: 0 }}>
          将下方的 API 地址复制到您的启动器，或直接拖动“拖拽添加到启动器”按钮到支持 authlib-injector 的启动器窗口中。
        </p>

        <CopyRow label="API 地址" value={apiUrl} onCopy={() => copy('api', apiUrl)} copied={copiedKey === 'api'} />

        <div>
          <a
            href={dragHref}
            draggable
            title="拖动我到启动器"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 18px', borderRadius: 999,
              background: 'var(--color-primary)', color: '#fff',
              fontSize: 14, fontWeight: 600, textDecoration: 'none',
              border: 'none', cursor: 'grab',
              boxShadow: '0 2px 8px color-mix(in srgb, var(--color-primary) 30%, transparent)',
            }}
          >
            <MousePointerClick style={{ width: 16, height: 16 }} />
            拖拽添加到启动器
          </a>
        </div>
        {!publicUrl && (
          <p style={{ fontSize: 12, color: 'var(--color-text-light)', margin: 0 }}>
            当前使用浏览器地址作为 API 域名。建议管理员在“管理后台 → 站点设置”填入对外的域名（public_url）以获得稳定的启动器接入地址。
          </p>
        )}
      </div>

      {/* Vanilla launcher / JVM */}
      <div className="surface-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MonitorSmartphone style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
            原版启动器接入
          </h2>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: 0 }}>
          先 <a style={{ color: 'var(--color-primary)', textDecoration: 'underline' }} href="https://github.com/yushijinhun/authlib-injector/releases" target="_blank" rel="noreferrer">下载 authlib-injector.jar</a>，
          然后在启动参数中添加：
        </p>
        <CopyRow label="JVM 参数" value={launchArg} onCopy={() => copy('arg', launchArg)} copied={copiedKey === 'arg'} mono />
      </div>

      {/* HMCL / PCL guidance */}
      <div className="surface-card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 12px 0' }}>
          HMCL / PCL 接入
        </h2>
        <ol style={{ paddingLeft: 20, fontSize: 13, color: 'var(--color-text-light)', lineHeight: 2, margin: 0 }}>
          <li>账户类型选择 <b style={{ color: 'var(--color-heading)' }}>外置认证 / Authlib-Injector</b>。</li>
          <li>认证服务器地址填入上方 API 地址：<code style={{ color: 'var(--color-heading)' }}>{apiUrl}</code></li>
          <li>使用注册时的 <b style={{ color: 'var(--color-heading)' }}>用户名 / 邮箱 / 手机号</b> 与密码登录。</li>
          <li>登录后选择已创建的角色，进入服务器即可显示自定义皮肤。</li>
        </ol>
      </div>

      {/* Server side */}
      <div className="surface-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Server style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
            服务器端接入
          </h2>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-light)', margin: 0 }}>
          在服务端启动参数添加 authlib-injector，并指向此 API 地址，即可让玩家使用像素北科账户加入：
        </p>
        <CopyRow label="服务端 JVM 参数" value={launchArg} onCopy={() => copy('srv', launchArg)} copied={copiedKey === 'srv'} mono />
      </div>
    </div>
  );
}

function CopyRow({
  label,
  value,
  onCopy,
  copied,
  mono,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--color-text-light)', marginBottom: 4 }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <code
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            background: 'var(--color-background-mute)', border: '1px solid var(--color-border)',
            fontSize: mono ? 12 : 13, wordBreak: 'break-all', color: 'var(--color-heading)',
          }}
        >
          {value}
        </code>
        <button onClick={onCopy} className="btn-ghost" style={{ padding: '10px 14px' }}>
          {copied ? <Check style={{ width: 16, height: 16, color: 'var(--color-primary)' }} /> : <Copy style={{ width: 16, height: 16 }} />}
        </button>
      </div>
    </div>
  );
}
