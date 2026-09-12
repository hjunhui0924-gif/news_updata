'use client';
import { useState } from 'react';
import { Radio, ArrowRight, CodeXml as Github } from 'lucide-react';
export function Login({ configured }: { configured: boolean }) {
  const [error, setError] = useState('');
  async function login() {
    const response = await fetch('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github', callbackURL: '/today' }),
    });
    const data = await response.json();
    if (response.ok && data.url) window.location.href = data.url;
    else setError('登录未完成，请检查账号权限和服务配置。');
  }
  return (
    <main className="login-page">
      <div className="login-card">
        <span className="brand-icon">
          <Radio size={25} />
        </span>
        <span className="eyebrow">NEWSROOM / 知更</span>
        <h1>
          好更新，
          <br />
          不再错过。
        </h1>
        <p>
          关注你喜欢的开发者与项目。
          <br />
          把每次变化，读成一份清楚的中文摘要。
        </p>
        <button className="button primary" disabled={!configured} onClick={login}>
          <Github size={18} />
          使用 GitHub 登录
          <ArrowRight size={16} />
        </button>
        {!configured && <p className="helper">登录尚未配置。本地体验请按 README 启动演示模式。</p>}
        {error && <p role="alert">{error}</p>}
        <span className="login-footnote">你的关注，你来决定。</span>
      </div>
    </main>
  );
}
