'use client';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  Clock3,
  Code2,
  FileText,
  Languages,
  Link2,
  Loader2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { FeedItem } from '@/shared/types';
import { Button } from './ui/button';
import { Markdown } from './markdown';
import { BilingualTranslation } from './bilingual-translation';
import { ItemSources } from './item-sources';
export function ItemDetail({
  item,
  toggleSaved,
  translate,
  summarize,
  busy,
  back,
  timezone,
  error,
  aiEnabled,
  projectSubscribed,
  projectSubscribeBusy,
  subscribeProject,
}: {
  item: FeedItem | null;
  toggleSaved: () => void;
  translate: () => void;
  summarize: () => void;
  busy: boolean;
  back: () => void;
  timezone: string;
  error?: string | null;
  aiEnabled: boolean;
  projectSubscribed?: boolean;
  projectSubscribeBusy?: boolean;
  subscribeProject?: () => void;
}) {
  const [tab, setTab] = useState<'summary' | 'translation' | 'original'>('summary');
  const [evidence, setEvidence] = useState(false);
  if (!item)
    return (
      <section className="detail-panel blank-detail">
        <div className="blank-mark">
          <RadioGlyph />
        </div>
        <span className="eyebrow">A LITTLE LESS NOISE</span>
        <h2>
          下一条值得关注的变化，
          <br />
          就在这里。
        </h2>
        <p>选择一条更新，阅读中文摘要与原文。</p>
      </section>
    );
  const translationTooLong = item.body.length > 16000 && !item.translation;
  return (
    <section className="detail-panel" aria-label="更新详情">
      <div className="detail-toolbar">
        <button className="back-button" onClick={back}>
          <ArrowLeft size={17} />
          返回列表
        </button>
        <span className="detail-breadcrumb">
          <FileText size={14} />
          更新详情
        </span>
        <div className="toolbar-actions">
          <button
            className={`icon-button ${item.saved ? 'is-saved' : ''}`}
            onClick={toggleSaved}
            title={item.saved ? '取消收藏' : '收藏更新'}
            aria-label={item.saved ? '取消收藏' : '收藏更新'}
          >
            <Bookmark size={18} fill={item.saved ? 'currentColor' : 'none'} />
          </button>
          <a
            className="icon-button"
            href={item.url}
            target="_blank"
            rel="noreferrer"
            aria-label="打开 GitHub 来源"
          >
            <ArrowUpRight size={20} />
          </a>
        </div>
      </div>
      <article className="detail-content">
        <div className="detail-source">
          <span className={`repo-avatar large ${item.color}`}>
            {item.repo.split('/').pop()?.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <strong>{item.repo}</strong>
            <span>{item.type === 'new_repo' ? '新项目' : '正式版本发布'} · GitHub</span>
          </div>
          <span className="status-chip">
            <Check size={12} />
            {item.read ? '已读' : '未读'}
          </span>
        </div>
        <h2 className="detail-title">{item.title}</h2>
        <ItemSources item={item} />
        {item.type === 'new_repo' && subscribeProject && (
          <div className="project-subscribe-card" aria-label="项目订阅">
            <div>
              <strong>想持续跟踪这个项目？</strong>
              <p>订阅后会收到它后续发布的正式版本更新。</p>
            </div>
            <Button
              size="small"
              variant="primary"
              onClick={subscribeProject}
              disabled={projectSubscribed || projectSubscribeBusy}
            >
              {projectSubscribeBusy
                ? '正在添加…'
                : projectSubscribed
                  ? '已订阅项目更新'
                  : '订阅项目更新'}
            </Button>
          </div>
        )}
        <div className="detail-meta">
          <span>
            <Clock3 size={13} />
            {new Date(item.publishedAt).toLocaleString('zh-CN', {
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: timezone,
            })}
          </span>
          <span>{timezone}</span>
          {item.demo && <span className="demo-label">演示内容 · 非官方发布记录</span>}
        </div>
        {item.body.length > 4000 && (
          <div className="long-content-note" role="status">
            <FileText size={16} />
            <div>
              <strong>正文较长</strong>
              <span>
                约 {item.body.length.toLocaleString('zh-CN')} 字符，切换到原文后可按 Markdown 结构阅读。
              </span>
            </div>
          </div>
        )}
        <div className="detail-tabs" role="tablist" aria-label="内容视图">
          {[
            { key: 'summary', label: '中文摘要', icon: Sparkles },
            { key: 'translation', label: '对照翻译', icon: Languages },
            { key: 'original', label: '原文', icon: Code2 },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key as typeof tab)}
              className={tab === key ? 'active' : ''}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="tab-content">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {tab === 'summary' &&
            (item.summary ? (
              <>
                <div className="summary-intro">
                  <div className="summary-label">
                    <Sparkles size={15} />
                    {item.demo ? '摘要示例' : 'AI 内容摘要'}
                    <span>简明版</span>
                  </div>
                  <p>{item.summary.overview}</p>
                </div>
                <section className="reading-section">
                  <h3>这次更新了什么</h3>
                  <div className="change-list">
                    {item.summary.changes.map((change, index) => (
                      <div key={index} className="change-row">
                        <span className="change-number">0{index + 1}</span>
                        <p>{change.text}</p>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="impact-box">
                  <span className="impact-icon">
                    <ShieldCheck size={19} />
                  </span>
                  <div>
                    <h3>
                      对你可能有什么用
                      <span>
                        {item.summary.impact.kind === 'inferred'
                          ? '推测影响'
                          : item.summary.impact.kind === 'unknown'
                            ? '信息不足'
                            : '原文说明'}
                      </span>
                    </h3>
                    <p>{item.summary.impact.text}</p>
                  </div>
                </section>
                <section className="reading-section compatibility">
                  <h3>升级前留意</h3>
                  <p>
                    {item.summary.migrationNote ||
                      '原文没有明确说明迁移要求，建议升级前查看项目文档。'}
                  </p>
                  <span className="neutral-tag">
                    兼容性：
                    {item.summary.breakingChange === 'unknown'
                      ? '原文未明确说明'
                      : item.summary.breakingChange === 'yes'
                        ? '存在不兼容变化'
                        : '原文明确兼容'}
                  </span>
                </section>
                <button
                  className="evidence-toggle"
                  onClick={() => setEvidence(!evidence)}
                  aria-expanded={evidence}
                >
                  <Link2 size={14} />
                  查看摘要依据 <ChevronDown size={14} />
                </button>
                {evidence && (
                  <div className="evidence-list">
                    {item.summary.evidence.map((source) => (
                      <p key={source.id}>
                        <strong>[{source.id}]</strong> {source.text}
                      </p>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="ai-empty">
                <Sparkles size={28} />
                <h3>
                  {!item.body
                    ? '暂无可供总结的正文'
                    : !item.demo && !aiEnabled
                      ? 'AI 摘要尚未启用'
                      : busy
                        ? '该条目的 AI 任务正在处理…'
                        : '这条更新还没有中文摘要'}
                </h3>
                <p>
                  {!item.demo && !aiEnabled
                    ? 'AI 服务当前关闭，暂时无法生成摘要。你可以切换到「原文」阅读更新。'
                    : item.aiError ||
                      (busy
                        ? '任务正在排队或生成中，完成后会自动显示。'
                        : '生成中文概览、关键变化和原文依据。')}
                </p>
                <Button
                  onClick={summarize}
                  disabled={busy || !item.body || (!item.demo && !aiEnabled)}
                >
                  {busy ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}生成摘要
                </Button>
              </div>
            ))}
          {tab === 'original' &&
            (item.body ? (
              <Markdown text={item.body} baseUrl={item.contentUrl ?? item.url} />
            ) : (
              <div className="empty-state">
                <FileText size={28} />
                <h3>暂无可读取的正文</h3>
                <p>你仍可以前往 GitHub 查看项目信息。</p>
              </div>
            ))}
          {tab === 'translation' &&
            (item.language === 'zh' ? (
              <Markdown text={item.body} baseUrl={item.contentUrl ?? item.url} />
            ) : item.translation ? (
              <BilingualTranslation item={item} />
            ) : translationTooLong ? (
              <div className="translation-limit-note" role="note">
                <Languages size={28} />
                <h3>原文超过 16000 字符</h3>
                <p>当前版本不生成超长全文对照译文，请切换到「原文」按 Markdown 结构阅读。</p>
              </div>
            ) : (
              <div className="ai-empty">
                <Languages size={30} />
                <h3>用熟悉的语言，读懂细节</h3>
                <p>
                  {item.demo
                    ? '体验按需翻译流程，演示译文已预先编写，不消耗模型额度。'
                    : !aiEnabled
                      ? 'AI 服务当前关闭，暂时无法翻译。你可以切换到「原文」阅读更新。'
                      : '点击下方按钮生成中文译文，完成后会保存，后续打开可直接阅读。'}
                </p>
                <Button
                  variant="primary"
                  onClick={translate}
                  disabled={busy || !item.body || (!item.demo && !aiEnabled)}
                >
                  {busy ? <Loader2 size={16} className="spin" /> : <Languages size={16} />}
                  生成中文翻译
                </Button>
              </div>
            ))}
        </div>
        <footer className="reading-footer">
          <span>
            <ShieldCheck size={14} />
            {item.demo ? '以上内容是用于体验的固定示例' : '摘要用于辅助阅读，请以来源为准'}
          </span>
          <a href={item.url} target="_blank" rel="noreferrer">
            {item.demo ? '查看参考项目' : item.contentUrl ? '查看项目来源' : '查看完整原文'}
            <ArrowUpRight size={14} />
          </a>
          {item.contentUrl && item.contentUrl !== item.url && (
            <a href={item.contentUrl} target="_blank" rel="noreferrer">
              查看正文来源
              <ArrowUpRight size={14} />
            </a>
          )}
        </footer>
      </article>
    </section>
  );
}
function RadioGlyph() {
  return <FileText size={32} strokeWidth={1.3} />;
}
