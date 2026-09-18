'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Code2,
  CodeXml as Github,
  ChevronLeft,
  FileCode2,
  FolderOpen,
  Languages,
  ListChecks,
  Lightbulb,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import {
  skillCategories,
  skillTags,
  type SkillCategory,
  type SkillTag,
} from '@/shared/skill-taxonomy';
import type {
  SkillAiState,
  SkillCatalogPage,
  SkillDetails,
  SkillSource,
  SkillSummary,
} from '@/shared/skills';
import { bilingualTree } from '@/shared/bilingual';
import { Markdown } from './markdown';
import { Button } from './ui/button';

const emptyCatalog: SkillCatalogPage = { skills: [], nextPage: null, truncated: false };

async function requestSkills<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Skill 暂时无法读取。');
  return data as T;
}

function withoutFrontmatter(markdown: string) {
  return markdown.replace(/^---\s*[\s\S]*?\r?\n---\s*/, '');
}

function sourceLabel(source: SkillSource) {
  return source === 'local' ? '本机已安装' : 'GitHub Star';
}

function scopeLabel(skill: SkillSummary) {
  if (skill.source === 'github') return 'Star 项目';
  if (skill.scope === 'system') return '系统 Skill';
  if (skill.scope === 'plugin') return '插件 Skill';
  if (skill.scope === 'project') return '项目 Skill';
  return '用户 Skill';
}

function Capability({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (!active) return null;
  return <span className="skill-capability">{children}</span>;
}

const emptyAi: SkillAiState = {
  summary: null,
  translation: null,
  summaryStatus: 'idle',
  translationStatus: 'idle',
  summaryError: null,
  translationError: null,
};

function SkillBilingual({
  original,
  translation,
  baseUrl,
}: {
  original: string;
  translation: string;
  baseUrl?: string;
}) {
  return (
    <div className="skill-bilingual" role="region" aria-label="Skill 中英文对照">
      <Markdown
        text={original}
        tree={bilingualTree(original, translation, { includeHeadings: true })}
        baseUrl={baseUrl}
      />
    </div>
  );
}

function SkillOriginalView({
  detail,
  ai,
  busy,
  generate,
  revealTranslation,
}: {
  detail: SkillDetails;
  ai: SkillAiState;
  busy: boolean;
  generate: () => void;
  revealTranslation: boolean;
}) {
  const [manualVisible, setManualVisible] = useState<boolean | null>(null);
  const bilingual = !!ai.translation && (manualVisible ?? revealTranslation);
  const translationUnavailable = ai.translationStatus === 'disabled';
  return (
    <div className="skill-original-view">
      <div className="skill-original-toolbar">
        <div className="skill-original-heading">
          <Code2 size={16} />
          <div>
            <strong>{bilingual ? '中英文对照' : '原文'}</strong>
            <span>{bilingual ? '原文在上，中文译文在下' : '保留 SKILL.md 的原始结构'}</span>
          </div>
        </div>
        {ai.translation && (
          <button
            type="button"
            className="skill-translation-toggle"
            aria-pressed={bilingual}
            onClick={() => setManualVisible(!bilingual)}
          >
            <Languages size={14} /> {bilingual ? '仅看原文' : '显示中英文对照'}
          </button>
        )}
      </div>
      {!ai.translation && (
        <div className="skill-translation-cta">
          <div>
            <strong>在原文下生成中文对照</strong>
            <p>
              {ai.translationError ||
                (translationUnavailable
                  ? 'AI 服务未启用，当前仅提供原文。'
                  : '按段落保留 Markdown、代码、链接和命令格式。')}
            </p>
          </div>
          <Button
            variant="primary"
            size="small"
            onClick={generate}
            disabled={busy || translationUnavailable || ai.translationStatus === 'pending'}
          >
            {busy || ai.translationStatus === 'pending' ? (
              <Loader2 className="spin" size={15} />
            ) : (
              <Languages size={15} />
            )}
            {ai.translationStatus === 'failed' ? '重试对照翻译' : '生成中文对照'}
          </Button>
        </div>
      )}
      {bilingual ? (
        <SkillBilingual
          original={withoutFrontmatter(detail.content)}
          translation={ai.translation!.text}
          baseUrl={detail.url}
        />
      ) : (
        <Markdown text={withoutFrontmatter(detail.content)} baseUrl={detail.url} />
      )}
    </div>
  );
}

function SkillAiSummary({
  detail,
  ai,
  busy,
  generate,
}: {
  detail: SkillDetails;
  ai: SkillAiState;
  busy: boolean;
  generate: () => void;
}) {
  if (!ai.summary) {
    return (
      <div className="skill-ai-empty skill-guide-empty">
        <div className="skill-guide-empty-art" aria-hidden="true">
          <Sparkles size={27} />
          <span />
          <span />
          <span />
        </div>
        <span className="skill-guide-empty-kicker">SKILL 入门介绍</span>
        <h3>
          {ai.summaryStatus === 'pending'
            ? '正在整理 Skill 摘要…'
            : ai.summaryStatus === 'failed'
              ? '摘要生成失败'
              : '先生成一份易懂的介绍'}
        </h3>
        <p>
          {ai.summaryError ||
            (ai.summaryStatus === 'disabled'
              ? 'AI 服务未启用，仍可直接阅读原文。'
              : `根据 ${detail.name} 的说明，整理它解决什么问题、适用场景、工作流和注意事项。`)}
        </p>
        <div className="skill-guide-empty-description">
          <span>原始简介</span>
          <p>{detail.description}</p>
        </div>
        <div className="skill-guide-empty-facts">
          <span><BookOpen size={14} /> 保留完整原文</span>
          <span><ListChecks size={14} /> 摘要后续可生成</span>
        </div>
        <Button onClick={generate} disabled={busy || ai.summaryStatus === 'disabled'}>
          {busy || ai.summaryStatus === 'pending' ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <Sparkles size={16} />
          )}
          {ai.summaryStatus === 'failed' ? '重试摘要' : '生成 AI 摘要'}
        </Button>
      </div>
    );
  }
  const summary = ai.summary;
  const workflowPreview = summary.workflow.slice(0, 3);
  return (
    <div className="skill-ai-summary skill-guide">
      <div className="skill-guide-hero">
        <div className="skill-guide-hero-copy">
          <div className="skill-ai-label">
            <Sparkles size={15} /> AI 摘要 <span>辅助理解 · 以原文为准</span>
          </div>
          <span className="skill-guide-kicker">先用一句话理解</span>
          <h2>{summary.headline}</h2>
          <p>{summary.overview}</p>
          {detail.repositoryDescription && (
            <div className="skill-guide-project-note">
              <span>项目简介</span>
              <p>{detail.repositoryDescription}</p>
            </div>
          )}
        </div>
        <div className="skill-guide-hero-art" aria-label="Skill 使用路径示意图">
          <div className="skill-guide-art-heading">
            <Lightbulb size={15} />
            <span>使用路径</span>
          </div>
          <div className="skill-guide-art-track">
            {workflowPreview.map((item, index) => (
              <div className="skill-guide-art-step" key={`${index}-${item}`}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <p>{item}</p>
                {index < workflowPreview.length - 1 && <ArrowRight size={14} aria-hidden="true" />}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="skill-guide-section-heading">
        <div className="skill-guide-section-icon"><Target size={16} /></div>
        <div>
          <h3>适用场景</h3>
          <p>先判断它是否适合当前任务，再开始阅读具体步骤。</p>
        </div>
      </div>
      <div className="skill-guide-scenarios">
        {summary.scenarios.map((item, index) => (
          <div className="skill-guide-scenario" key={`${index}-${item}`}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <p>{item}</p>
          </div>
        ))}
      </div>
      <div className="skill-guide-section-heading skill-guide-workflow-heading">
        <div className="skill-guide-section-icon"><ListChecks size={16} /></div>
        <div>
          <h3>怎么使用</h3>
          <p>把 AI 摘要整理成一条可快速浏览的工作流。</p>
        </div>
      </div>
      <div className="skill-guide-workflow" aria-label="Skill 建议工作流">
        {summary.workflow.map((item, index) => (
          <div className="skill-guide-workflow-step" key={`${index}-${item}`}>
            <div className="skill-guide-workflow-marker">
              <span>{index + 1}</span>
              {index < summary.workflow.length - 1 && <i aria-hidden="true" />}
            </div>
            <div className="skill-guide-workflow-copy">
              <strong>步骤 {index + 1}</strong>
              <p>{item}</p>
            </div>
            <CheckCircle2 size={16} aria-hidden="true" />
          </div>
        ))}
      </div>
      {ai.summary.cautions.length > 0 && (
        <section className="skill-ai-cautions skill-guide-cautions">
          <ShieldCheck size={18} />
          <div>
            <h3>使用前留意</h3>
          <ul>{summary.cautions.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </section>
      )}
      {summary.evidence.length > 0 && (
        <details className="skill-ai-evidence skill-guide-evidence">
          <summary>查看摘要依据（{summary.evidence.length} 段）</summary>
          {summary.evidence.map((item) => (
            <p key={item.id}><strong>[{item.id}]</strong> {item.text}</p>
          ))}
        </details>
      )}
    </div>
  );
}

function SkillCard({ skill, onSelect }: { skill: SkillSummary; onSelect: (skill: SkillSummary) => void }) {
  return (
    <article className="skill-card">
      <button
        type="button"
        className="skill-card-main"
        data-testid={`skill-card-${skill.id}`}
        onClick={() => onSelect(skill)}
      >
        <span className={`skill-card-icon ${skill.source === 'github' ? 'github' : ''}`}>
          {skill.source === 'github' ? <Star size={19} /> : <BookOpen size={19} />}
        </span>
        <span className="skill-card-body">
          <span className="skill-card-heading">
            <strong>{skill.name}</strong>
            <span className="skill-scope-tag">{scopeLabel(skill)}</span>
          </span>
          <span className="skill-card-description">{skill.description}</span>
          {skill.tags.length > 0 && (
            <span className="skill-card-tags" aria-label="Skill 标签">
              {skill.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
              {skill.tags.length > 3 && <span>+{skill.tags.length - 3}</span>}
            </span>
          )}
          <span className="skill-card-footer">
            <span>{skill.repository || skill.location}</span>
            <span className="skill-capabilities" aria-label="Skill 附件">
              <Capability active={skill.files.scripts}>
                <FileCode2 size={13} /> 脚本
              </Capability>
              <Capability active={skill.files.references}>
                <FolderOpen size={13} /> 参考资料
              </Capability>
              <Capability active={skill.files.assets}>
                <FolderOpen size={13} /> 资源
              </Capability>
            </span>
          </span>
        </span>
        <ArrowUpRight className="skill-card-arrow" size={16} />
      </button>
      <div className="skill-card-sources" aria-label={`${skill.name} 来源链接`}>
        {skill.repositoryUrl && (
          <a
            href={skill.repositoryUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            <Github size={13} /> 打开项目
          </a>
        )}
        {skill.url && (
          <a
            href={skill.url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            <Link2 size={13} /> Skill 源文件
          </a>
        )}
        {!skill.repositoryUrl && !skill.url && (
          <span title={`${skill.location} · ${skill.relativePath}`}>
            <FolderOpen size={13} /> 本机来源 · {skill.relativePath}
          </span>
        )}
      </div>
    </article>
  );
}

function SkillDetail({
  detail,
  onBack,
  generate,
  busyKind,
  revealTranslation,
}: {
  detail: SkillDetails;
  onBack: () => void;
  generate: (kind: 'summary' | 'translation') => void;
  busyKind: 'summary' | 'translation' | '';
  revealTranslation: boolean;
}) {
  const [tab, setTab] = useState<'summary' | 'original'>('summary');
  const ai = detail.ai ?? emptyAi;
  return (
    <section className="skill-detail-view" aria-label={`${detail.name} Skill 详情`}>
      <button type="button" className="skill-back" onClick={onBack}>
        <ChevronLeft size={16} /> 返回 Skill 列表
      </button>
      <div className="skill-detail-heading">
        <div>
          <span className="eyebrow">{sourceLabel(detail.source)}</span>
          <h1>{detail.name}</h1>
          <div className="skill-detail-description">
            <span className="skill-description-label">Skill 简介</span>
            <p>{detail.description}</p>
          </div>
        </div>
        <div className="skill-detail-actions">
          {detail.repositoryUrl && (
            <a className="button small primary" href={detail.repositoryUrl} target="_blank" rel="noreferrer">
              <Github size={14} /> 打开项目
            </a>
          )}
          {detail.url && (
            <a className="button small" href={detail.url} target="_blank" rel="noreferrer">
              <Link2 size={14} /> 查看 Skill 文件
            </a>
          )}
        </div>
      </div>
      <div className="skill-detail-meta">
        <span className="skill-detail-origin">
          {detail.repository ? <Github size={13} /> : <FolderOpen size={13} />}
          {detail.repository || detail.location}
        </span>
        <span>{detail.relativePath}</span>
        <span>{detail.category}</span>
        {detail.tags.length > 0 && <span>{detail.tags.join(' · ')}</span>}
        {detail.files.interface && <span>包含界面配置</span>}
      </div>
      <div className="skill-detail-tabs" role="tablist" aria-label="Skill 内容视图">
        {[
          { key: 'summary', label: 'AI 摘要', icon: Sparkles },
          { key: 'original', label: '原文', icon: Code2 },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key as typeof tab)}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      <article className="skill-detail-content">
        {tab === 'summary' && (
          <SkillAiSummary
            detail={detail}
            ai={ai}
            busy={busyKind === 'summary'}
            generate={() => generate('summary')}
          />
        )}
        {tab === 'original' && (
          <SkillOriginalView
            key={`${detail.contentHash}-${detail.ai.translation ? 'translated' : 'original'}`}
            detail={detail}
            ai={ai}
            busy={busyKind === 'translation'}
            generate={() => generate('translation')}
            revealTranslation={revealTranslation}
          />
        )}
      </article>
    </section>
  );
}

export function SkillsPanel() {
  const [source, setSource] = useState<SkillSource>('local');
  const [catalogs, setCatalogs] = useState<Record<SkillSource, SkillCatalogPage>>({
    local: emptyCatalog,
    github: emptyCatalog,
  });
  const [loaded, setLoaded] = useState<Record<SkillSource, boolean>>({ local: false, github: false });
  const [selected, setSelected] = useState<SkillSummary | null>(null);
  const [detail, setDetail] = useState<SkillDetails | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SkillCategory | 'all'>('all');
  const [selectedTags, setSelectedTags] = useState<SkillTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyKind, setBusyKind] = useState<'summary' | 'translation' | ''>('');
  const [revealTranslation, setRevealTranslation] = useState(false);

  const load = useCallback(async (nextSource: SkillSource, page = 1, append = false) => {
    setLoading(true);
    setError('');
    try {
      const result = await requestSkills<SkillCatalogPage>(
        nextSource === 'local' ? '/api/skills/local' : `/api/skills/starred?page=${page}`,
      );
      setCatalogs((current) => ({
        ...current,
        [nextSource]: {
          ...result,
          skills: append ? [...current[nextSource].skills, ...result.skills] : result.skills,
        },
      }));
      setLoaded((current) => ({ ...current, [nextSource]: true }));
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loaded[source]) return;
    const timer = window.setTimeout(() => void load(source), 0);
    return () => window.clearTimeout(timer);
  }, [load, loaded, source]);

  useEffect(() => {
    const onPopState = () => {
      if (!new URLSearchParams(window.location.search).has('id')) {
        setSelected(null);
        setDetail(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const catalog = catalogs[source];
  const categoryCounts = useMemo(
    () => new Map(skillCategories.map((value) => [value, catalog.skills.filter((skill) => skill.category === value).length])),
    [catalog.skills],
  );
  const tagCounts = useMemo(
    () => new Map(skillTags.map((value) => [value, catalog.skills.filter((skill) => skill.tags.includes(value)).length])),
    [catalog.skills],
  );
  const availableTags = skillTags.filter((value) => tagCounts.get(value));
  const visibleSkills = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value && category === 'all' && selectedTags.length === 0) return catalog.skills;
    return catalog.skills.filter((skill) =>
      (category === 'all' || skill.category === category) &&
      selectedTags.every((tag) => skill.tags.includes(tag)) &&
      [skill.name, skill.description, skill.repository, skill.location, skill.category, ...skill.tags]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(value)),
    );
  }, [catalog.skills, category, query, selectedTags]);

  async function selectSkill(skill: SkillSummary) {
    setSelected(skill);
    setDetail(null);
    setRevealTranslation(false);
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ id: skill.id });
    history.pushState({}, '', `/skills?${params}`);
    try {
      setDetail(await requestSkills<SkillDetails>(`/api/skills/detail?${params}`));
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function generateAi(kind: 'summary' | 'translation') {
    if (!selected) return;
    if (kind === 'translation') setRevealTranslation(true);
    setBusyKind(kind);
    setError('');
    try {
      await requestSkills('/api/skills/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, kind }),
      });
      const params = new URLSearchParams({ id: selected.id });
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        const next = await requestSkills<SkillDetails>(`/api/skills/detail?${params}`);
        setDetail(next);
        const status = next.ai?.[`${kind}Status`];
        if (status !== 'pending' && status !== 'idle') break;
      }
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setBusyKind('');
    }
  }

  function backToList() {
    setSelected(null);
    setDetail(null);
    setRevealTranslation(false);
    history.pushState({}, '', '/skills');
  }

  function changeSource(nextSource: SkillSource) {
    setSource(nextSource);
    setSelected(null);
    setDetail(null);
    setQuery('');
    setCategory('all');
    setSelectedTags([]);
    setError('');
    history.pushState({}, '', '/skills');
  }

  if (selected && detail)
    return (
      <SkillDetail
        detail={detail}
        onBack={backToList}
        generate={generateAi}
        busyKind={busyKind}
        revealTranslation={revealTranslation}
      />
    );

  return (
    <section className="skills-page management-page" aria-label="Skill 目录">
      <div className="management-heading skills-heading">
        <div>
          <span className="eyebrow">KNOW YOUR TOOLS</span>
          <h1>Skill 目录</h1>
          <p>查看本机已经安装的 Skill，也可以浏览 GitHub Star 项目中的可用 Skill。</p>
        </div>
        <Button size="small" onClick={() => void load(source)} disabled={loading}>
          {loading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
          刷新目录
        </Button>
      </div>
      <div className="skills-summary">
        <span>
          <strong>{catalog.skills.length}</strong> 个可用 Skill
        </span>
        <span>
          <BookOpen size={15} /> {sourceLabel(source)}
        </span>
        {catalog.username && <span className="skills-summary-user"><Github size={14} /> {catalog.username} 的 Star</span>}
      </div>
      <div className="segmented skills-tabs" role="tablist" aria-label="Skill 来源">
        {(['local', 'github'] as SkillSource[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={source === value}
            className={source === value ? 'selected' : ''}
            onClick={() => changeSource(value)}
          >
            {value === 'local' ? <BookOpen size={14} /> : <Star size={14} />}
            {sourceLabel(value)}
          </button>
        ))}
      </div>
      <div className="skills-toolbar">
        <label className="search-box" htmlFor="skill-search">
          <Search size={15} />
          <input
            id="skill-search"
            aria-label="搜索 Skill"
            placeholder="搜索名称、简介或来源"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" className="skill-search-clear" aria-label="清除 Skill 搜索" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </label>
        <span className="skills-result-count">显示 {visibleSkills.length} 个</span>
      </div>
      <div className="skill-filters" aria-label="Skill 分类与标签筛选">
        <div className="skill-filter-row">
          <span className="skill-filter-label">分类</span>
          <div className="skill-filter-options" role="group" aria-label="Skill 分类">
            <button
              type="button"
              className={category === 'all' ? 'active' : ''}
              aria-pressed={category === 'all'}
              onClick={() => setCategory('all')}
            >
              全部 <small>{catalog.skills.length}</small>
            </button>
            {skillCategories.filter((value) => categoryCounts.get(value)).map((value) => (
              <button
                type="button"
                key={value}
                className={category === value ? 'active' : ''}
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
              >
                {value} <small>{categoryCounts.get(value)}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="skill-filter-row">
          <span className="skill-filter-label">标签</span>
          <div className="skill-filter-options skill-tag-options" role="group" aria-label="Skill 标签">
            {availableTags.map((value) => {
              const active = selectedTags.includes(value);
              return (
                <button
                  type="button"
                  key={value}
                  className={active ? 'active' : ''}
                  aria-pressed={active}
                  onClick={() =>
                    setSelectedTags((current) =>
                      active ? current.filter((tag) => tag !== value) : [...current, value],
                    )
                  }
                >
                  {value} <small>{tagCounts.get(value)}</small>
                </button>
              );
            })}
            {!availableTags.length && <span className="skill-filter-muted">暂无标签</span>}
          </div>
        </div>
        {(category !== 'all' || selectedTags.length > 0 || query) && (
          <button
            type="button"
            className="skill-clear-filters"
            onClick={() => {
              setCategory('all');
              setSelectedTags([]);
              setQuery('');
            }}
          >
            <X size={13} /> 清除筛选
          </button>
        )}
      </div>
      {error && (
        <div className="skills-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => void load(source)} disabled={loading}>重试</button>
        </div>
      )}
      {loading && !catalog.skills.length ? (
        <div className="skills-loading" role="status">
          <Loader2 className="spin" size={20} /> 正在读取 Skill 目录…
        </div>
      ) : visibleSkills.length ? (
        <div className="skill-list">
          {visibleSkills.map((skill) => <SkillCard key={skill.id} skill={skill} onSelect={selectSkill} />)}
        </div>
      ) : (
        <div className="skills-empty">
          <BookOpen size={30} />
          <h2>{query || category !== 'all' || selectedTags.length > 0 ? '没有匹配的 Skill' : source === 'github' ? '暂时没有读取到 Star Skill' : '本机还没有可识别的 Skill'}</h2>
          <p>{query || category !== 'all' || selectedTags.length > 0 ? '换一个关键词、分类或标签组合试试。' : source === 'github' ? '请先连接 GitHub，或确认 Star 项目包含 SKILL.md。' : 'Skill 目录需要包含带有 name 和 description 的 SKILL.md。'}</p>
        </div>
      )}
      {catalog.nextPage && !query && (
        <div className="skills-load-more">
          <Button size="small" onClick={() => void load(source, catalog.nextPage!, true)} disabled={loading}>
            {loading ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />} 加载更多 Star Skill
          </Button>
          {catalog.truncated && <span>仓库文件树较大，部分目录可能未被 GitHub 返回。</span>}
        </div>
      )}
      {selected && loading && (
        <div className="skill-detail-loading" role="status"><Loader2 className="spin" size={18} /> 正在读取 Skill 说明…</div>
      )}
    </section>
  );
}
