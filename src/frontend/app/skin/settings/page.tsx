'use client';

import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';

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
    <div className="container py-12 max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">authlib-injector 接入</h1>
        <p className="text-muted-foreground">
          像素北科皮肤站完整实现了 Yggdrasil 协议,可在任意支持 authlib-injector 的 Minecraft 启动器中接入。
        </p>
      </header>

      <section className="glass-card p-6 space-y-3">
        <h2 className="text-lg font-semibold">Yggdrasil 服务地址</h2>
        <p className="text-sm text-muted-foreground">在 HMCL、PCL、Bakaxl 等启动器中作为"外置登录"地址。</p>
        <CopyRow label="API Root" value={apiUrl} onCopy={() => copy('api', apiUrl)} copied={copiedKey === 'api'} />
      </section>

      <section className="glass-card p-6 space-y-3">
        <h2 className="text-lg font-semibold">原版启动器接入</h2>
        <p className="text-sm text-muted-foreground">
          先 <a className="text-primary hover:underline" href="https://github.com/yushijinhun/authlib-injector/releases" target="_blank" rel="noreferrer">下载 authlib-injector.jar</a>,
          然后在启动参数中添加：
        </p>
        <CopyRow label="JVM 参数" value={launchArg} onCopy={() => copy('arg', launchArg)} copied={copiedKey === 'arg'} mono />
      </section>

      <section className="glass-card p-6 space-y-3">
        <h2 className="text-lg font-semibold">HMCL / PCL 接入</h2>
        <ol className="list-decimal pl-5 text-sm space-y-2 text-muted-foreground">
          <li>账户类型选择 <b className="text-foreground">外置认证 / Authlib-Injector</b>。</li>
          <li>认证服务器地址填入上方 API Root：<code className="text-foreground">{apiUrl}</code></li>
          <li>使用注册时的邮箱与密码登录。</li>
          <li>登录后选择已创建的角色,进入服务器即可显示自定义皮肤。</li>
        </ol>
      </section>

      <section className="glass-card p-6 space-y-3">
        <h2 className="text-lg font-semibold">服务器端接入</h2>
        <p className="text-sm text-muted-foreground">
          在服务端启动参数添加 authlib-injector,并指向此 API Root,即可让玩家使用像素北科账户加入：
        </p>
        <CopyRow label="服务端 JVM 参数" value={launchArg} onCopy={() => copy('srv', launchArg)} copied={copiedKey === 'srv'} mono />
      </section>
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
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className={`flex-1 px-3 py-2 rounded-xl bg-muted/40 border border-input break-all ${mono ? 'text-xs' : 'text-sm'}`}>
          {value}
        </code>
        <button onClick={onCopy} className="btn-ghost px-3 py-2">
          {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
