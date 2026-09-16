'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Code2,
  CodeXml as Github,
  ChevronLeft,
  FileCode2,
  FolderOpen,
  Languages,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Sparkles,
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

function SkillBilingual({ blocks }: { blocks: { original: string; translation: string | null }[] }) {
  return (
    <div className="skill-bilingual" aria-label="Skill 中英文对照">
      {blocks.map((block, index) => (
        <section className="skill-bilingual-block" key={`${index}-${block.original.slice(0, 24)}`}>
          <div className="skill-bilingual-label">原文</div>
          <div className="skill-bilingual-original">{block.original}</div>
          <div className="skill-bilingual-label translated">中文</div>
          <div className="skill-bilingual-translation">
            {block.translation || '该段暂未生成译文。'}
          </div>
        </section>
      ))}
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
      <div className="skill-ai-empty">
        <Sparkles size={27} />
        <h3>
          {ai.summaryStatus === 'pending'
            ? '正在整理 Skill 摘要…'
            : ai.summaryStatus === 'failed'
              ? '摘要生成失败'
              : '还没有 Skill 摘要'}
        </h3>
        <p>
          {ai.summaryError ||
            (ai.summaryStatus === 'disabled'
              ? 'AI 服务未启用，仍可直接阅读原文。'
              : `根据 ${detail.name} 的说明，整理适用场景、工作流和注意事项。`)}
        </p>
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
  return (
    <div className="skill-ai-summary">
      <div className="skill-ai-summary-intro">
        <div className="skill-ai-label">
          <Sparkles size={15} /> AI 摘要 <span>辅助理解 · 以原文为准</span>
        </div>
        <h2>{ai.summary.headline}</h2>
        <p>{ai.summary.overview}</p>
      </div>
      <div className="skill-ai-grid">
        <section>
          <h3>适用场景</h3>
          <ul>
            {ai.summary.scenarios.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
        <section>
          <h3>建议工作流</h3>
          <ol>
            {ai.summary.workflow.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </section>
      </div>
      {ai.summary.cautions.length > 0 && (
        <section className="skill-ai-cautions">
          <ShieldCheck size={18} />
          <div>
            <h3>使用前留意</h3>
            <ul>{ai.summary.cautions.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </section>
      )}
      {ai.summary.evidence.length > 0 && (
        <details className="skill-ai-evidence">
          <summary>查看摘要依据（{ai.summary.evidence.length} 段）</summary>
          {ai.summary.evidence.map((item) => (
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
      {skill.repositoryUrl ? (
        <a
          className="skill-project-link"
          href={skill.repositoryUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          <Github size={13} /> 打开项目
        </a>
      ) : (
        <span className="skill-project-local">
          <FolderOpen size={13} /> 本机目录
        </span>
      )}
    </article>
  );
}

function SkillDetail({
  detail,
  onBack,
  generate,
  busyKind,
}: {
  detail: SkillDetails;
  onBack: () => void;
  generate: (kind: 'summary' | 'translation') => void;
  busyKind: 'summary' | 'translation' | '';
}) {
  const [tab, setTab] = useState<'summary' | 'translation' | 'original'>('summary');
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
          <p>{detail.description}</p>
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
          { key: 'translation', label: '中英文对照', icon: Languages },
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
        {tab === 'translation' && (
          ai.translation ? (
            <SkillBilingual blocks={ai.translation.blocks} />
          ) : (
            <div className="skill-ai-empty">
              <Languages size={28} />
              <h3>
                {ai.translationStatus === 'pending'
                  ? '正在生成中英文对照…'
                  : ai.translationStatus === 'failed'
                    ? '对照翻译失败'
                    : '还没有中英文对照'}
              </h3>
              <p>
                {ai.translationError ||
                  (ai.translationStatus === 'disabled'
                    ? 'AI 服务未启用，仍可阅读原文。'
                    : '按段落保留 Markdown、代码、链接和命令格式。')}
              </p>
              <Button
                variant="primary"
                onClick={() => generate('translation')}
                disabled={busyKind === 'translation' || ai.translationStatus === 'disabled'}
              >
                {busyKind === 'translation' || ai.translationStatus === 'pending' ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <Languages size={16} />
                )}
                {ai.translationStatus === 'failed' ? '重试对照翻译' : '生成中英文对照'}
              </Button>
            </div>
          )
        )}
        {tab === 'original' && <Markdown text={withoutFrontmatter(detail.content)} />}
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
