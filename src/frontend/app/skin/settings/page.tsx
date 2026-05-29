'use client';

import { useEffect, useState } from 'react';
import { Copy, Check, Terminal, MonitorSmartphone, Server } from 'lucide-react';

export default function SkinSettingsPage() {
  const [origin, setOrigin] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const apiUrl = `${origin}/skinapi/`;
  const launchArg = `-javaagent:authlib-injector.jar=${apiUrl}`;

  function copy(key: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '48px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div>
        <p className="section-kicker" style={{ marginBottom: 8 }}>SETUP</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-heading)', margin: 0 }}>
          authlib-injector 接入
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-light)', marginTop: 4 }}>
          像素北科皮肤站完整实现了 Yggdrasil 协议，可在任意支持 authlib-injector 的 Minecraft 启动器中接入。
        </p>
      </div>

      {/* API Root */}
      <div className="surface-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Terminal style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
            Yggdrasil 服务地址
          </h2>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-light)', marginBottom: 12 }}>
          在 HMCL、PCL、Bakaxl 等启动器中作为"外置登录"地址。
        </p>
        <CopyRow label="API Root" value={apiUrl} onCopy={() => copy('api', apiUrl)} copied={copiedKey === 'api'} />
      </div>

      {/* Vanilla launcher */}
      <div className="surface-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <MonitorSmartphone style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
            原版启动器接入
          </h2>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-light)', marginBottom: 12 }}>
          先 <a style={{ color: 'var(--color-primary)', textDecoration: 'underline' }} href="https://github.com/yushijinhun/authlib-injector/releases" target="_blank" rel="noreferrer">下载 authlib-injector.jar</a>，
          然后在启动参数中添加：
        </p>
        <CopyRow label="JVM 参数" value={launchArg} onCopy={() => copy('arg', launchArg)} copied={copiedKey === 'arg'} mono />
      </div>

      {/* HMCL / PCL */}
      <div className="surface-card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: '0 0 12px 0' }}>
          HMCL / PCL 接入
        </h2>
        <ol style={{ paddingLeft: 20, fontSize: 13, color: 'var(--color-text-light)', lineHeight: 2 }}>
          <li>账户类型选择 <b style={{ color: 'var(--color-heading)' }}>外置认证 / Authlib-Injector</b>。</li>
          <li>认证服务器地址填入上方 API Root：<code style={{ color: 'var(--color-heading)' }}>{apiUrl}</code></li>
          <li>使用注册时的邮箱与密码登录。</li>
          <li>登录后选择已创建的角色，进入服务器即可显示自定义皮肤。</li>
        </ol>
      </div>

      {/* Server side */}
      <div className="surface-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Server style={{ width: 20, height: 20, color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-heading)', margin: 0 }}>
            服务器端接入
          </h2>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-light)', marginBottom: 12 }}>
          在服务端启动参数添加 authlib-injector，并指向此 API Root，即可让玩家使用像素北科账户加入：
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
