'use client';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Check,
  CodeXml,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import type { Bootstrap } from '@/shared/types';
import { Button } from './ui/button';

export function HomePanel({
  data,
  navigate,
  onAdd,
  help = false,
}: {
  data: Bootstrap;
  navigate: (view: string) => void;
  onAdd: (method: 'repo' | 'channel') => void;
  help?: boolean;
}) {
  const router = useRouter();
  const sources = data.subscriptions.filter((source) => source.enabled);
  const active = data.jobs.filter((job) => ['pending', 'running'].includes(job.status)).length;
  const youtube = data.services.youtubeAuth;
  const youtubeConnected = !!youtube && ['connected', 'refresh_pending'].includes(youtube.state);
  const hasSynced = sources.some((source) => !!source.lastSyncAt);
  const steps = [
    {
      title: '登录你的账号',
      text: data.guest
        ? '登录后才能读取你的 GitHub 账号和关注来源。'
        : data.mode === 'demo'
          ? '当前是演示空间，真实使用时通过官方页面授权登录。'
          : '已进入你的独立工作空间，无需填写平台密钥。',
      complete: data.mode === 'live' && !data.guest,
      action: data.guest ? '登录 GitHub' : '管理账号',
      run: () => (data.guest ? router.push('/login') : navigate('connections')),
    },
    {
      title: '添加关注来源',
      text: data.guest
        ? '当前没有用户内容。登录后可以添加项目、开发者或 YouTube 频道。'
        : sources.length
          ? `已启用 ${sources.length} 个来源。可以继续导入 Star、开发者或频道。`
          : '添加一个项目，或从自己的 Star、关注列表中选择导入。',
      complete: sources.length > 0,
      action: data.guest ? '查看空订阅页' : sources.length ? '管理订阅' : '添加第一个来源',
      run: () =>
        data.guest
          ? navigate('subscriptions')
          : sources.length
            ? navigate('subscriptions')
            : onAdd('repo'),
    },
    {
      title: '等待首次同步',
      text: !data.services.workerOnline
        ? '后台同步暂时离线，已有内容仍可阅读；请联系站点管理员。'
        : active
          ? `后台有 ${active} 项任务处理中，可先阅读已有内容。`
          : hasSynced
            ? '已有来源完成同步，后续更新由后台定期检查。'
            : '添加来源后由后台采集，暂时没有更新也可能是来源尚无新内容。',
      complete: hasSynced,
      action: '查看同步状态',
      run: () => navigate('subscriptions'),
    },
    {
      title: '按自己的节奏阅读',
      text: '筛选平台、标记已读和收藏；需要时再启用摘要与对照翻译。',
      complete: (data.feed?.saved ?? 0) > 0,
      action: '开始阅读',
      run: () => navigate('feed'),
    },
  ];
  return (
    <section className="management-page home-page">
      <div className="home-content">
        <header className="home-heading">
          <span className="eyebrow">YOUR READING SPACE</span>
          <h1>{help ? '从这里，开始使用知更' : '把关注，读成有用的更新。'}</h1>
          <p>
            {data.guest
              ? '这是一个没有用户内容的空工作区。登录后才会读取你的订阅、已读、收藏和平台连接。'
              : help
                ? '登录、订阅和阅读的操作都在这里；平台密钥由站点管理员配置。'
                : '一个属于你的阅读空间。连接关注的来源，后续变化在这里汇合。'}
          </p>
          <div className="home-actions">
            <Button
              variant="primary"
              onClick={() => (data.guest ? router.push('/login') : navigate('feed'))}
            >
              {data.guest ? '使用 GitHub 登录' : '进入信息流'}
              <ArrowRight size={17} />
            </Button>
            <Button onClick={() => (data.guest ? navigate('feed') : onAdd('repo'))}>
              <Plus size={17} />
              {data.guest ? '浏览空信息流' : '添加关注'}
            </Button>
          </div>
        </header>
        <div className="home-status-row" aria-label="工作空间状态">
          <span>
            <span
              className={`status-indicator ${data.services.workerOnline ? 'online' : 'offline'}`}
            />
            {data.services.workerOnline ? '后台同步运行中' : '后台同步暂时离线'}
          </span>
          <span>{sources.length} 个启用来源</span>
          <span>{data.feed?.unread ?? 0} 条未读</span>
          <span>
            {data.services.ai
              ? data.services.aiMode === 'personal'
                ? '使用个人 AI'
                : '站点 AI 可用'
              : '原文阅读可用 · AI 可选'}
          </span>
        </div>
        <div className="home-section-heading">
          <div>
            <h2>首次使用，四步就好</h2>
            <p>不必一次配齐，先关注一个感兴趣的来源。</p>
          </div>
          <span className="neutral-tag">{data.mode === 'demo' ? '演示数据' : '个人工作空间'}</span>
        </div>
        <ol className="home-steps">
          {steps.map((step, index) => (
            <li key={step.title} className={step.complete ? 'step-complete' : ''}>
              <span
                className="step-number"
                aria-label={step.complete ? '已完成' : `第 ${index + 1} 步`}
              >
                {step.complete ? <Check size={18} /> : String(index + 1).padStart(2, '0')}
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <button onClick={step.run}>
                {step.action}
                <ArrowRight size={15} />
              </button>
            </li>
          ))}
        </ol>
        <div className="home-section-heading">
          <div>
            <h2>连接你的关注</h2>
            <p>在官方页面完成授权，你的账号密码不会交给知更。</p>
          </div>
          <button className="home-text-link" onClick={() => navigate('connections')}>
            账号与连接
            <ArrowRight size={15} />
          </button>
        </div>
        <div className="home-connections">
          <article>
            <span className="home-platform-icon">
              <CodeXml size={24} />
            </span>
            <div>
              <h3>
                GitHub{' '}
                <span className="connection-pill">
                  {data.mode === 'demo'
                    ? '演示模式'
                    : data.guest
                      ? '登录后连接'
                      : data.services.github
                        ? '已连接'
                        : '需要重新连接'}
                </span>
              </h3>
              <p>项目版本、开发者动态与自己的 Star。选择导入，保留个人阅读进度。</p>
            </div>
            <Button
              size="small"
              onClick={() =>
                data.guest
                  ? router.push('/login')
                  : data.mode === 'live' && !data.services.github
                    ? navigate('connections')
                    : onAdd('repo')
              }
            >
              {data.guest
                ? '登录后连接'
                : data.mode === 'live' && !data.services.github
                  ? '检查授权'
                  : '选择关注'}
              <ArrowRight size={15} />
            </Button>
          </article>
          <article>
            <span className="home-platform-icon youtube">
              <Play size={24} />
            </span>
            <div>
              <h3>
                YouTube{' '}
                <span className="connection-pill">
                  {data.mode === 'demo'
                    ? '演示模式'
                    : data.guest
                      ? '登录后连接'
                      : youtubeConnected
                        ? '已连接'
                        : !youtube?.configured
                          ? '等待站点配置'
                          : '尚未连接'}
                </span>
              </h3>
              <p>连接自己的账号，读取关注频道并导入。视频简介可按需对照翻译。</p>
            </div>
            <Button
              size="small"
              onClick={() => (data.guest ? router.push('/login') : onAdd('channel'))}
            >
              {data.guest ? '登录后连接' : youtubeConnected ? '导入频道' : '连接 YouTube'}
              <ArrowRight size={15} />
            </Button>
          </article>
        </div>
        <aside className="home-ai-note">
          <span className="home-platform-icon">
            <Sparkles size={22} />
          </span>
          <div>
            <h2>AI 是阅读助手，也是可选项</h2>
            <p>未配置模型也能阅读原文。使用站点提供的服务，或在个人设置中连接自己的模型账号。</p>
          </div>
          <Button onClick={() => navigate('ai-settings')}>
            设置 AI 服务
            <ArrowRight size={15} />
          </Button>
        </aside>
        {help && (
          <section className="home-help">
            <h2>
              <BookOpen size={20} />
              使用时可能遇到的问题
            </h2>
            {[
              [
                '连接了账号，为什么还没有内容？',
                '授权只建立账号连接。还需要选择来源并导入，然后等待后台 Worker 首次同步；项目没有正式 Release 或频道近期没有视频时可以为空。',
              ],
              [
                '需要填写 GitHub 或 Google 的密钥吗？',
                '普通用户不需要。登录或连接按钮不可用时，请联系站点管理员；不要把账号密码、OAuth 客户端密钥或回调链接发给别人。',
              ],
              [
                '刷新页面会立即采集吗？',
                '刷新只获取站内最新状态。需要重新采集时，在订阅管理中触发同步，并等待任务完成。',
              ],
              [
                'AI 费用由谁承担？',
                '使用站点 AI 时由站点配置的模型账号承担；选择个人 AI 后由你填写密钥对应的模型账号承担。测试连接也可能产生少量费用。预算只是应用估算，应在模型供应商处设置硬额度。',
              ],
            ].map(([title, text]) => (
              <details key={title}>
                <summary>{title}</summary>
                <p>{text}</p>
              </details>
            ))}
          </section>
        )}
        <p className="home-footnote">
          <RefreshCw size={14} />
          后台定期同步，内容并非实时推送。授权与导入均不会改变你在原平台的关注关系。
        </p>
      </div>
    </section>
  );
}
