import { ArrowRight, CodeXml, Play, ShieldCheck } from 'lucide-react';
import type { Bootstrap } from '@/shared/types';
import { Button } from './ui/button';
import { GitHubConnection } from './github-connection';
import { PersonalSettingsNav } from './personal-settings-nav';
export function ConnectionsPanel({
  data,
  navigate,
  onChecked,
  onYouTube,
}: {
  data: Bootstrap;
  navigate: (view: string) => void;
  onChecked: () => Promise<unknown>;
  onYouTube: () => void;
}) {
  const youtube = data.services.youtubeAuth;
  return (
    <section className="management-page settings-page">
      <PersonalSettingsNav view="connections" navigate={navigate} />
      <div className="management-heading">
        <div>
          <span className="eyebrow">YOUR CONNECTED ACCOUNTS</span>
          <h1>账号与连接</h1>
          <p>管理平台授权与导入入口。普通用户无需填写平台密钥。</p>
        </div>
      </div>
      <section className="settings-card">
        <div className="settings-card-heading">
          <CodeXml size={20} />
          <h2>GitHub 登录账号</h2>
        </div>
        <p className="helper">
          {data.mode === 'demo'
            ? '当前为本地演示空间。真实使用时在 GitHub 官方页面登录。'
            : `当前登录：${data.user.name}。关注来源与阅读记录保存在这个工作空间中。`}
        </p>
        {data.mode === 'live' && (
          <GitHubConnection status={data.services.githubAuth} onChecked={onChecked} />
        )}
        <Button onClick={() => navigate('subscriptions')}>
          管理 GitHub 订阅
          <ArrowRight size={15} />
        </Button>
      </section>
      <section className="settings-card">
        <div className="settings-card-heading">
          <Play size={20} />
          <h2>YouTube 账号</h2>
          <span className="neutral-tag">
            {data.mode === 'demo' ? '演示模式' : (youtube?.name ?? '尚未连接')}
          </span>
        </div>
        <p className="helper">
          {data.mode === 'demo'
            ? '通过 Google 官方授权读取自己的关注，选择频道后才会导入。'
            : (youtube?.message ?? '尚未连接 YouTube，可从连接入口开始授权。')}
        </p>
        <Button onClick={onYouTube}>
          {youtube && ['connected', 'refresh_pending'].includes(youtube.state)
            ? '管理连接与导入频道'
            : '连接 YouTube'}
          <ArrowRight size={15} />
        </Button>
      </section>
      <p className="personal-settings-note">
        <ShieldCheck size={16} />
        退出知更不会撤销平台授权，也不会删除订阅。YouTube 的断开入口位于连接管理弹窗。
      </p>
    </section>
  );
}
