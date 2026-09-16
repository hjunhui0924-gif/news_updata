'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  CodeXml as Github,
  ChevronLeft,
  FileCode2,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Star,
  X,
} from 'lucide-react';
import type { SkillCatalogPage, SkillDetails, SkillSource, SkillSummary } from '@/shared/skills';
import { Markdown } from './markdown';
import { Button } from './ui/button';

const emptyCatalog: SkillCatalogPage = { skills: [], nextPage: null, truncated: false };

async function requestSkills<T>(url: string) {
  const response = await fetch(url);
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

function SkillCard({ skill, onSelect }: { skill: SkillSummary; onSelect: (skill: SkillSummary) => void }) {
  return (
    <button
      type="button"
      className="skill-card"
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
  );
}

function SkillDetail({
  detail,
  onBack,
}: {
  detail: SkillDetails;
  onBack: () => void;
}) {
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
        {detail.url && (
          <a className="button small" href={detail.url} target="_blank" rel="noreferrer">
            <ArrowUpRight size={14} /> 查看来源
          </a>
        )}
      </div>
      <div className="skill-detail-meta">
        <span>{detail.repository || detail.location}</span>
        <span>{detail.relativePath}</span>
        {detail.files.interface && <span>包含界面配置</span>}
      </div>
      <article className="skill-detail-content">
        <Markdown text={withoutFrontmatter(detail.content)} />
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
  const visibleSkills = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return catalog.skills;
    return catalog.skills.filter((skill) =>
      [skill.name, skill.description, skill.repository, skill.location]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(value)),
    );
  }, [catalog.skills, query]);

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
    setError('');
    history.pushState({}, '', '/skills');
  }

  if (selected && detail) return <SkillDetail detail={detail} onBack={backToList} />;

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
          <h2>{query ? '没有匹配的 Skill' : source === 'github' ? '暂时没有读取到 Star Skill' : '本机还没有可识别的 Skill'}</h2>
          <p>{query ? '换一个名称或关键词试试。' : source === 'github' ? '请先连接 GitHub，或确认 Star 项目包含 SKILL.md。' : 'Skill 目录需要包含带有 name 和 description 的 SKILL.md。'}</p>
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
