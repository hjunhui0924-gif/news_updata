import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, Check, CheckCheck,
  ChevronDown, ChevronRight, Circle, Code2, ExternalLink, FileText, FolderOpen,
  CodeXml as Github, Grid2X2, Inbox, LayoutList, Menu, MoreHorizontal, PanelsTopLeft,
  Play, Plus, Radio, Search, Settings2, SlidersHorizontal, Sparkles, X,
} from 'lucide-react';

type Entry = {
  id: number; platform: 'github' | 'youtube'; source: string; initial: string;
  title: string; excerpt: string; category: string; time: string; duration: string;
  read: boolean; saved: boolean; art?: 'blue' | 'dark' | 'paper';
};
const examples: Entry[] = [
  { id: 1, platform: 'github', source: 'vercel / next.js', initial: 'N', title: '一次框架更新，哪些变化值得你真正关注？', excerpt: '把缓存、构建与迁移说明放在同一条阅读路径里。先了解关键变化，再按需查看原文与依据。', category: '版本更新', time: '12 分钟前', duration: '4 分钟阅读', read: false, saved: false, art: 'blue' },
  { id: 2, platform: 'youtube', source: 'Interface Notes', initial: 'IN', title: '好的信息流，应该让内容站到前面', excerpt: '从导航层级到阅读密度，重新思考一个聚合产品的界面。', category: '设计与产品', time: '35 分钟前', duration: '视频 · 前往原站', read: false, saved: true, art: 'dark' },
  { id: 3, platform: 'github', source: 'vitejs / vite', initial: 'V', title: '构建工具的新变化：更清晰的开发反馈', excerpt: '一份更新说明的阅读示例。区分功能变化、兼容性说明与仍需确认的影响。', category: '开发工具', time: '1 小时前', duration: '3 分钟阅读', read: false, saved: false },
  { id: 4, platform: 'github', source: 'shadcn-ui / ui', initial: 'ui', title: '从组件到系统，让界面保持一致', excerpt: '组件库更新示例：把可访问性、交互反馈与主题规范放在一起阅读。', category: '界面开发', time: '2 小时前', duration: '5 分钟阅读', read: true, saved: true },
  { id: 5, platform: 'youtube', source: 'Build Journal', initial: 'BJ', title: '少一点工具切换，多一点连续思考', excerpt: '一次关于个人工作流的分享。这里仅展示视频简介，不提供视频全文或转写。', category: '工作方式', time: '3 小时前', duration: '视频 · 前往原站', read: false, saved: false, art: 'paper' },
  { id: 6, platform: 'github', source: 'vercel / next.js', initial: 'N', title: '更新说明被编辑后，阅读状态应该如何保留', excerpt: '同一条内容的新版本仍沿用原来的收藏与来源归属。', category: '文档编辑', time: '4 小时前', duration: '2 分钟阅读', read: true, saved: false },
  { id: 7, platform: 'youtube', source: 'Interface Notes', initial: 'IN', title: '从一张白纸，组织你的个人阅读空间', excerpt: '信息架构示例：用来源与内容类型帮助筛选，而不是把每种工具都放进主导航。', category: '设计与产品', time: '昨天', duration: '视频 · 前往原站', read: true, saved: false },
  { id: 8, platform: 'github', source: 'vitejs / vite', initial: 'V', title: '依赖升级之前，先读清楚迁移边界', excerpt: '保留原始链接、版本说明与可核对的依据，让阅读结果可追溯。', category: '版本更新', time: '昨天', duration: '4 分钟阅读', read: true, saved: false },
];
const sourceNames = [...new Set(examples.map((entry) => entry.source))];
const displayName = (platform: string) => platform === 'github' ? 'GitHub' : 'YouTube';
const PlatformIcon = ({ platform, size = 14 }: { platform: string; size?: number }) =>
  platform === 'github' ? <Github size={size} /> : <Play size={size} />;

function Cover({ kind, small = false }: { kind: 'blue' | 'dark' | 'paper'; small?: boolean }) {
  return <div className={`cover cover-${kind} ${small ? 'small' : ''}`} aria-hidden="true">
    <span className="cover-caption">{kind === 'blue' ? 'RELEASE NOTES / 001' : kind === 'dark' ? 'INTERFACE NOTES' : 'BUILD JOURNAL'}</span>
    <div className="cover-title">{kind === 'blue' ? <>BUILD.<br />READ.<br />REPEAT.</> : kind === 'dark' ? <>LESS NOISE.<br /><span>MORE SIGNAL.</span></> : <>MAKE ROOM<br />FOR WHAT<br /><em>MATTERS.</em></>}</div>
    {kind === 'blue' ? <ArrowUpRight className="cover-arrow" strokeWidth={1} /> : <span className="play-disc"><Play size={18} fill="currentColor" /></span>}
    <span className="cover-credit">{kind === 'blue' ? '知更 · 概念封面' : '概念封面 · 非实际视频画面'}</span>
  </div>;
}

function App() {
  const [entries, setEntries] = useState(examples);
  const [section, setSection] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<'overview' | 'list' | 'reader'>('overview');
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState('original');
  const [drawer, setDrawer] = useState(false);
  const [tools, setTools] = useState(false);
  const [dialog, setDialog] = useState('');
  const [toast, setToast] = useState('');
  const [notice, setNotice] = useState(true);
  const search = useRef<HTMLInputElement>(null);
  const closeDialog = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const readCount = entries.filter((entry) => !entry.read).length;
  const saved = entries.filter((entry) => entry.saved);
  const filtered = entries.filter((entry) =>
    (section !== 'unread' || !entry.read) && (section !== 'saved' || entry.saved) &&
    (platform === 'all' || entry.platform === platform) && (!source || entry.source === source) &&
    (!query || `${entry.title} ${entry.excerpt} ${entry.source}`.toLowerCase().includes(query.toLowerCase())),
  );
  const active = entries.find((entry) => entry.id === selected) ?? filtered[0];

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); search.current?.focus(); }
      if (event.key === 'Escape') { setDialog(''); setDrawer(false); setSelected(null); }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!dialog && !drawer) return;
    previousFocus.current = document.activeElement as HTMLElement;
    closeDialog.current?.focus();
    const previous = previousFocus.current;
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [dialog, drawer]);

  function notify(text: string) { setToast(text); }
  function navigate(next: string, nextPlatform = 'all', nextSource = '') {
    setSection(next); setPlatform(nextPlatform); setSource(nextSource); setSelected(null); setDrawer(false); setQuery('');
  }
  function open(entry: Entry) {
    setSelected(entry.id); setTab('original');
    setEntries((current) => current.map((row) => row.id === entry.id ? { ...row, read: true } : row));
  }
  function save(entry: Entry) {
    setEntries((current) => current.map((row) => row.id === entry.id ? { ...row, saved: !row.saved } : row));
    notify(entry.saved ? '已移出收藏 · 仅本次草图有效' : '已加入收藏 · 仅本次草图有效');
  }
  function goBack() {
    const previous = selected;
    setSelected(null);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-entry="${previous}"]`)?.focus({ preventScroll: true }));
  }
  const heading = section === 'sources' ? '你的来源，你的信息流。' : source || (section === 'saved' ? '值得留下的内容。' : section === 'unread' ? '留给下一次好奇。' : '关注的世界，正在更新。');

  function sidebar(mobile = false) {
    return <aside className={`sidebar ${mobile ? 'mobile-sidebar' : ''}`} aria-label="聚合导航">
      <div className="brand-row"><a className="brand" href="#" onClick={(event) => { event.preventDefault(); navigate('all'); }}><Radio size={23} /><span>知更<span className="brand-en">NEWSROOM</span></span></a>{mobile && <button className="icon-button" aria-label="关闭导航" ref={closeDialog} onClick={() => setDrawer(false)}><X size={20} /></button>}</div>
      <span className="sidebar-caption">你的阅读空间</span>
      <nav className="primary-nav" aria-label={mobile ? '手机主导航' : '主导航'}>
        {[
          { id: 'all', text: '全部信息流', icon: Inbox, count: entries.length },
          { id: 'unread', text: '未读更新', icon: Circle, count: readCount },
          { id: 'saved', text: '我的收藏', icon: Bookmark, count: saved.length },
        ].map(({ id, text, icon: Icon, count }) => <button key={id} className={`nav-item ${section === id && platform === 'all' && !source ? 'active' : ''}`} onClick={() => navigate(id)} aria-current={section === id && platform === 'all' && !source ? 'page' : undefined}><Icon size={17} /><span>{text}</span><span className="nav-count">{count}</span></button>)}
      </nav>
      <div className="sidebar-divider" />
      <div className="caption-row"><span className="sidebar-caption">平台</span><button aria-label="添加平台来源" className="tiny-icon" onClick={() => setDialog('add')}><Plus size={15} /></button></div>
      {['github', 'youtube'].map((id) => <button key={id} className={`nav-item platform-nav ${platform === id && !source ? 'active' : ''}`} onClick={() => navigate('all', id)}><PlatformIcon platform={id} size={17} /><span>{displayName(id)}</span><span className="nav-count">{entries.filter((entry) => entry.platform === id).length}</span></button>)}
      <div className="caption-row sources-caption"><span className="sidebar-caption">订阅来源</span><button className="tiny-icon" aria-label="管理全部来源" onClick={() => navigate('sources')}><SlidersHorizontal size={14} /></button></div>
      <div className="source-links">{sourceNames.map((name) => { const entry = entries.find((row) => row.source === name)!; return <button key={name} className={`source-link ${source === name ? 'selected' : ''}`} onClick={() => navigate('all', 'all', name)}><span className={`source-avatar ${entry.platform}`}>{entry.initial}</span><span>{name.includes('/') ? name.split('/')[1].trim() : name}</span><span className="source-unread">{entries.filter((row) => row.source === name && !row.read).length || ''}</span></button>; })}</div>
      <button className="manage-sources" onClick={() => navigate('sources')}><FolderOpen size={16} />管理订阅来源<ArrowUpRight size={14} /></button>
      <div className="sidebar-bottom">
        <button className="nav-item secondary-nav" aria-expanded={tools} onClick={() => setTools(!tools)}><MoreHorizontal size={17} /><span>更多工具</span><ChevronDown size={14} className={tools ? 'rotated' : ''} /></button>
        {tools && <div className="tools-list"><button onClick={() => setDialog('skills')}>Skill 目录<ArrowUpRight size={12} /></button><button onClick={() => setDialog('discover')}>GitHub 热门发现<ArrowUpRight size={12} /></button></div>}
        <button className="nav-item secondary-nav" onClick={() => setDialog('settings')}><Settings2 size={17} /><span>偏好设置</span></button>
        <button className="profile" onClick={() => setDialog('profile')}><span className="profile-avatar">我</span><span><strong>我的个人空间</strong><small>本地 UI 草图 · 示例数据</small></span><ChevronDown size={13} /></button>
      </div>
    </aside>;
  }

  function sourceLine(entry: Entry) {
    return <div className="entry-source"><span className={`source-avatar ${entry.platform}`}>{entry.initial}</span><span>{entry.source}</span><PlatformIcon platform={entry.platform} size={12} /><time>{entry.time}</time></div>;
  }
  function timelineEntry(entry: Entry) {
    return <article key={entry.id} className={`timeline-entry ${entry.read ? 'is-read' : ''}`}>
      <div className={`timeline-platform ${entry.platform}`}><PlatformIcon platform={entry.platform} size={16} /></div>
      <div className="timeline-copy">
        <div className="timeline-meta"><span>{displayName(entry.platform)}</span><span aria-hidden="true">·</span><span>{entry.source}</span><span className="timeline-kind">{entry.platform === 'youtube' ? '视频' : '更新'}</span></div>
        <button className="timeline-title" data-entry={entry.id} onClick={() => open(entry)}><h2>{entry.title}</h2></button>
        <p>{entry.excerpt}</p>
        <div className="timeline-bottom"><span>{entry.category}</span><span>{entry.duration}</span>{entry.read && <span className="read-state"><Check size={12} />已读</span>}</div>
      </div>
      <div className="timeline-actions"><time>{entry.time}</time><button className={`icon-button bookmark-button ${entry.saved ? 'saved' : ''}`} aria-label={`${entry.saved ? '取消收藏' : '收藏'}：${entry.title}`} onClick={() => save(entry)}><Bookmark size={16} fill={entry.saved ? 'currentColor' : 'none'} /></button></div>
    </article>;
  }
  function entryCard(entry: Entry, lead = false) {
    return <article key={entry.id} className={`entry-card ${lead ? 'lead-card' : ''} ${entry.read ? 'is-read' : ''}`}>
      {lead ? <div className="lead-copy">{sourceLine(entry)}<span className="entry-label">{entry.category}<span>READ THE CHANGE</span></span><button className="entry-title" data-entry={entry.id} onClick={() => open(entry)}><h2>{entry.title}</h2></button><p className="excerpt">{entry.excerpt}</p><div className="entry-bottom"><button className="read-link" onClick={() => open(entry)}>开始阅读 <ArrowRight size={15} /></button><span>{entry.duration}</span><button className={`icon-button bookmark-button ${entry.saved ? 'saved' : ''}`} aria-label={`${entry.saved ? '取消收藏' : '收藏'}：${entry.title}`} onClick={() => save(entry)}><Bookmark size={17} fill={entry.saved ? 'currentColor' : 'none'} /></button></div></div>
      : <>{sourceLine(entry)}<button className="entry-title" data-entry={entry.id} onClick={() => open(entry)}><h2>{entry.title}</h2></button><p className="excerpt">{entry.excerpt}</p><div className="entry-bottom"><span className="kind-tag">{entry.platform === 'youtube' ? <Play size={11} /> : <Code2 size={12} />}{entry.category}</span><span>{entry.duration}</span><button className={`icon-button bookmark-button ${entry.saved ? 'saved' : ''}`} aria-label={`${entry.saved ? '取消收藏' : '收藏'}：${entry.title}`} onClick={() => save(entry)}><Bookmark size={16} fill={entry.saved ? 'currentColor' : 'none'} /></button></div></>}
      {lead && entry.art && <button className="lead-art" onClick={() => open(entry)} aria-label={`阅读：${entry.title}`}><Cover kind={entry.art} /></button>}
      {!lead && entry.art && layout === 'overview' && <button className="card-art" onClick={() => open(entry)} aria-label={`查看：${entry.title}`}><Cover kind={entry.art} small /></button>}
    </article>;
  }

  function detail(entry: Entry) {
    return <section className="reader-article" aria-label="阅读详情">
      <div className="reader-actions"><button className="back-button" onClick={goBack}><ArrowLeft size={16} />返回信息流</button><div><button className={`icon-button ${entry.saved ? 'saved' : ''}`} aria-label={entry.saved ? '取消收藏当前内容' : '收藏当前内容'} onClick={() => save(entry)}><Bookmark size={18} fill={entry.saved ? 'currentColor' : 'none'} /></button><button className="icon-button" aria-label="打开原始链接说明" onClick={() => setDialog('original')}><ExternalLink size={17} /></button></div></div>
      <div className="article-body"><span className="eyebrow">{entry.platform === 'youtube' ? 'VIDEO / DESCRIPTION' : 'GITHUB / RELEASE NOTES'}</span>{sourceLine(entry)}<h1>{entry.title}</h1><p className="article-deck">{entry.excerpt}</p>
      <div className="article-tabs" role="tablist" aria-label="正文呈现方式">{(entry.platform === 'youtube' ? [['original', '视频简介']] : [['original', '原文'], ['summary', 'AI 摘要'], ['translation', '对照翻译']]).map(([id, name]) => <button role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)}>{id === 'summary' && <Sparkles size={13} />}{name}</button>)}</div>
      {entry.platform === 'youtube' ? <><Cover kind={entry.art ?? 'dark'} /><h2>关于这个视频</h2><p>这是一段用于说明页面结构的视频简介示例。视频类内容保持自己的呈现方式：展示作者、简介与来源入口，观看行为交给原平台。</p><button className="primary-button" onClick={() => setDialog('original')}>前往原站观看<ArrowUpRight size={15} /></button><p className="body-note">当前不读取视频全文，不把简介标为完整视频摘要。</p></>
      : tab === 'summary' ? <div className="ai-example"><span className="soft-label"><Sparkles size={13} />AI 摘要位置示意</span><h2>先理解变化，再决定是否深入。</h2><p>这里展示摘要的版式与引用位置。正式迁移时沿用现有证据、版本与预算逻辑；本草图没有调用模型。</p><ul><li>关键变化附原文依据，避免将推测写成事实。</li><li>AI 失败不影响原文、阅读和收藏。</li><li>内容或模型版本变化后，旧结果需重新确认。</li></ul><button className="outline-button" onClick={() => setTab('original')}>查看原文与依据<ArrowRight size={14} /></button></div>
      : tab === 'translation' ? <><p className="body-note">对照排版示例 · 非实际项目译文</p><div className="translation-block"><p>Focus on the changes that matter to your workflow.</p><p lang="zh-CN">关注真正影响你工作方式的变化。</p></div><div className="translation-block"><p>Keep the original source, and read at your own pace.</p><p lang="zh-CN">保留原始来源，按自己的节奏阅读。</p></div></>
      : <><p className="body-note">以下为 UI 排版示例，非真实项目的更新公告。</p><h2>把变化放回它的上下文里</h2><p>一个聚合平台的价值，不只是把多个网站的更新摆到一起。你应该能快速知道它来自哪里、更新了什么，以及是否值得继续读下去。</p><p>信息流负责帮助你选择，阅读视图负责让你专注。平台标签、时间、已读和收藏保持一致，正文则尊重不同来源的内容形态。</p><h2>保留来源，也保留阅读的连续性</h2><p>从列表进入详情后，返回时应回到原来的位置。筛选、翻页或后台同步不应该突然打断当前阅读。</p><blockquote>原文是基础，AI 是可选的阅读辅助。</blockquote><h2>你可以接着做什么</h2><ul><li>将内容加入收藏，留待以后继续阅读。</li><li>在需要时切换摘要或对照翻译。</li><li>沿着来源，查看同一个作者的更多更新。</li></ul></>}
      <div className="article-end"><span>本次阅读到这里</span><button className="read-link" onClick={goBack}>返回信息流 <ArrowRight size={15} /></button></div></div>
    </section>;
  }

  return <>
    <a className="skip-link" href="#main">跳到主要内容</a>
    <div className="app-shell">
      {sidebar()}
      <div className="workspace">
        <header className="topbar"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setDrawer(true)}><Menu size={21} /></button><div className="breadcrumb"><span>个人阅读空间</span><ChevronRight size={13} /><strong>{section === 'sources' ? '来源管理' : source ? '来源更新' : '信息流'}</strong></div><label className="search-box"><Search size={16} /><input ref={search} value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); if (section === 'sources') setSection('all'); }} placeholder="搜索已聚合的内容" aria-label="搜索已聚合的内容" /><kbd>Ctrl K</kbd></label><button className="primary-button add-source" onClick={() => setDialog('add')}><Plus size={16} /><span>添加来源</span></button></header>
        {notice && <div className="prototype-note"><span><span className="prototype-dot" />交互草图 V0<span className="note-separator">/</span>所有内容与数量均为示例，不连接真实账号</span><button aria-label="收起草图说明" onClick={() => setNotice(false)}><X size={13} /></button></div>}
        <main id="main" className={`${selected || layout === 'reader' ? 'reading-main' : ''}`} tabIndex={-1}>
        {section === 'sources' ? <div className="sources-page"><div className="page-heading"><div><span className="eyebrow">YOUR SOURCES</span><h1>{heading}</h1><p>账号连接、订阅来源和同步状态，集中放在这里。</p></div></div><div className="connection-grid">{['github', 'youtube'].map((id) => <section className="connection-card" key={id}><PlatformIcon platform={id} size={25} /><h2>{displayName(id)}</h2><span className={`connection-state ${id}`}>{id === 'github' ? '连接状态示例' : '实际授权待验收'}</span><p>{id === 'github' ? '仓库更新、开发者动态与个人关注。' : '连接自己的账号后，读取关注并选择导入。'}</p><button className="outline-button" onClick={() => setDialog('add')}>{id === 'github' ? '管理关注来源' : '查看连接说明'}<ArrowRight size={15} /></button></section>)}</div><div className="section-label"><h2>已导入来源</h2><span>{sourceNames.length} 个示例来源</span></div><div className="source-table">{sourceNames.map((name) => { const entry = entries.find((row) => row.source === name)!; return <button key={name} onClick={() => navigate('all', 'all', name)}><span className={`source-avatar ${entry.platform}`}>{entry.initial}</span><strong>{name}</strong><span>{displayName(entry.platform)}</span><span>示例数据</span><ArrowRight size={16} /></button>; })}</div></div>
        : selected || layout === 'reader' ? <div className={`reading-layout ${selected ? 'has-selection' : ''}`}><div className="reading-list"><div className="reading-list-heading"><h2>{source || (platform === 'all' ? '全部信息流' : displayName(platform))}</h2><button className="icon-button" aria-label="退出分栏阅读" onClick={() => { setSelected(null); setLayout('overview'); }}><Grid2X2 size={16} /></button></div>{filtered.map((entry) => <button key={entry.id} data-entry={entry.id} className={`reading-row ${active?.id === entry.id ? 'current' : ''}`} onClick={() => open(entry)}><span className="reading-row-source"><PlatformIcon platform={entry.platform} size={13} />{entry.source}<span>{entry.time}</span></span><strong>{entry.title}</strong><p>{entry.excerpt}</p><small>{entry.category}{entry.saved && <Bookmark size={12} fill="currentColor" />}</small></button>)}{!filtered.length && <div className="empty-state"><Search size={24} /><p>暂时没有匹配内容</p><button className="read-link" onClick={() => navigate('all')}>返回全部信息流</button></div>}</div>{active ? detail(active) : <section className="reader-article empty-state"><FileText size={32} /><h2>选择一条内容，开始阅读</h2></section>}</div>
        : <div className="overview-page"><div className="page-heading"><div><span className="eyebrow">YOUR DAILY SIGNAL<span>11 月 05 日 · 星期四</span></span><h1>{heading}</h1><p>来自你选择的来源。按自己的节奏，发现值得关注的变化。</p></div><span className="heading-index">{String(filtered.length).padStart(2, '0')}<small>条示例内容</small></span></div>
          <div className="feed-toolbar"><div className="platform-tabs" role="group" aria-label="平台筛选">{[['all', '全部'], ['github', 'GitHub'], ['youtube', 'YouTube']].map(([id, text]) => <button key={id} className={platform === id ? 'selected' : ''} aria-pressed={platform === id} onClick={() => { setPlatform(id); setSource(''); }}>{id !== 'all' && <PlatformIcon platform={id} size={13} />}{text}<span>{entries.filter((entry) => id === 'all' || entry.platform === id).length}</span></button>)}</div><div className="feed-tools"><button className="quiet-button" onClick={() => { const ids = new Set(filtered.map((entry) => entry.id)); setEntries((current) => current.map((entry) => ids.has(entry.id) ? { ...entry, read: true } : entry)); notify('当前筛选的示例内容已标记已读'); }}><CheckCheck size={15} /><span>全部已读</span></button><div className="view-switch" aria-label="信息流布局">{[{ id: 'overview' as const, icon: Grid2X2, name: '概览布局' }, { id: 'list' as const, icon: LayoutList, name: '列表布局' }, { id: 'reader' as const, icon: PanelsTopLeft, name: '分栏阅读布局' }].map(({ id, icon: Icon, name }) => <button key={id} className={layout === id ? 'selected' : ''} aria-label={name} title={name} aria-pressed={layout === id} onClick={() => setLayout(id)}><Icon size={16} /></button>)}</div></div></div>
          <div className="overview-columns"><div className="feed-content"><div className="section-label"><h2>{section === 'saved' ? '你的收藏' : section === 'unread' ? '还没读过的内容' : '按时间排列'}</h2><span><ArrowDown size={12} />最新优先</span></div>{filtered.length ? <>{layout === 'overview' ? <div className="timeline-list">{[...new Set(filtered.map((entry) => entry.time === '昨天' ? '昨天' : '今天'))].map((day) => { const dayEntries = filtered.filter((entry) => (entry.time === '昨天' ? '昨天' : '今天') === day); return <section className="timeline-group" key={day} aria-label={day}><h3>{day}<span>{dayEntries.length} 条</span></h3>{dayEntries.map(timelineEntry)}</section>; })}</div> : <div className={`entry-grid ${layout === 'list' ? 'list-layout' : ''}`}>{filtered.map((entry) => entryCard(entry))}</div>}<div className="feed-end"><Check size={14} />已展示全部 {filtered.length} 条示例内容</div></> : <div className="empty-state"><Search size={30} /><h2>这里暂时安静。</h2><p>试试其他来源或关键词。</p><button className="outline-button" onClick={() => navigate('all')}>查看全部信息流</button></div>}</div></div>
        </div>}
        </main>
        <footer className="workspace-footer"><span><span className="prototype-dot" />UI 概念预览<span>React · 本地示例</span></span><button onClick={() => setDialog('about')}>关于这次重构<ArrowUpRight size={12} /></button></footer>
      </div>
    </div>
    <nav className="mobile-bottom" aria-label="移动导航"><button onClick={() => navigate('all')} className={section === 'all' ? 'active' : ''}><Inbox size={19} />信息流</button><button onClick={() => navigate('unread')} className={section === 'unread' ? 'active' : ''}><Circle size={18} />未读</button><button onClick={() => navigate('saved')} className={section === 'saved' ? 'active' : ''}><Bookmark size={18} />收藏</button><button onClick={() => navigate('sources')} className={section === 'sources' ? 'active' : ''}><FolderOpen size={19} />来源</button></nav>
    {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)}><div role="dialog" aria-modal="true" aria-label="聚合导航" onClick={(event) => event.stopPropagation()}>{sidebar(true)}</div></div>}
    {dialog && <div className="modal-backdrop" onClick={() => setDialog('')}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Tab') { const nodes = event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input,a[href]'); const first = nodes[0], last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }}><button ref={closeDialog} className="icon-button modal-close" aria-label="关闭说明" onClick={() => setDialog('')}><X size={20} /></button><span className="eyebrow">{dialog === 'add' || dialog === 'youtube' ? 'CONNECT YOUR SOURCES' : 'NEWSROOM / CONCEPT'}</span><h2 id="modal-title">{dialog === 'add' || dialog === 'youtube' ? '让关注的更新，来到这里。' : dialog === 'skills' ? 'Skill，回到工具的位置。' : dialog === 'original' ? '原文入口始终保留。' : dialog === 'settings' ? '按你的习惯阅读。' : dialog === 'discover' ? '发现与个人信息流分开。' : '一个围绕内容的聚合空间。'}</h2><p>{dialog === 'add' || dialog === 'youtube' ? '在正式界面中连接自己的平台账号，再选择关注来源导入。以下只展示入口，不发起真实授权。' : dialog === 'skills' ? '已有 Skill 目录会保留在“更多工具”，退出聚合平台的一级导航。这里展示入口层级，不迁移或删改现有功能。' : dialog === 'original' ? '本草图没有真实外链，避免将示例内容误认为项目公告。正式界面沿用当前条目的原始链接与内容来源。' : dialog === 'settings' ? '列表密度、主题与连接管理将在正式迁移时复用现有设置。这版先体验顶部的三种布局切换。' : '导航围绕信息流、未读、收藏和来源组织；AI 是阅读辅助，Skill 是次级工具。所有操作仅影响当前草图，不写入项目数据库。'}</p>{(dialog === 'add' || dialog === 'youtube') && <div className="connect-options"><button onClick={() => notify('草图入口：正式开发时复用现有 GitHub 账号与关注导入')}><Github size={24} /><span><strong>GitHub</strong><small>连接账号，导入仓库与开发者关注</small></span><ArrowRight size={17} /></button><button onClick={() => notify('真实 YouTube 授权仍待验收；草图不发起授权')}><Play size={24} /><span><strong>YouTube</strong><small>我的关注 · 实际授权待验收</small></span><ArrowRight size={17} /></button><div className="future-platforms"><span>以后可扩展</span><span>Bilibili</span><span>RSS</span><small>规划中，尚未接入</small></div></div>}<button className="primary-button modal-done" onClick={() => setDialog('')}>继续看草图<ArrowRight size={15} /></button></section></div>}
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
