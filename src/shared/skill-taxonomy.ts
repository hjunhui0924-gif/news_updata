import type { SkillScope, SkillSummary } from './skills';

export const skillCategories = [
  '开发与工程',
  '测试与质量',
  '设计与前端',
  '文档与内容',
  '研究与数据',
  '联网与搜索',
  '自动化与扩展',
  '其他',
] as const;

export type SkillCategory = (typeof skillCategories)[number];

export const skillTags = [
  'Codex',
  'AI 与模型',
  '代码',
  '测试',
  '前端',
  '设计',
  '文档',
  '研究',
  '数据',
  '联网',
  '自动化',
  '插件',
] as const;

export type SkillTag = (typeof skillTags)[number];

type TaxonomyInput = Pick<SkillSummary, 'name' | 'description' | 'relativePath' | 'repository'> & {
  scope?: SkillScope;
};

const categoryRules: { category: SkillCategory; words: string[] }[] = [
  { category: '测试与质量', words: ['test', 'testing', 'debug', 'diagnos', 'lint', 'review', 'quality', 'playwright'] },
  { category: '设计与前端', words: ['ui', 'ux', 'design', 'frontend', 'front-end', 'react', 'next', 'css', 'web design', 'visual'] },
  { category: '文档与内容', words: ['document', 'writing', 'article', 'content', 'markdown', 'pdf', 'presentation', 'ppt', 'spreadsheet', 'word'] },
  { category: '研究与数据', words: ['research', 'kaggle', 'data', 'machine learning', 'automl', 'experiment', 'analysis', 'sql'] },
  { category: '联网与搜索', words: ['search', 'social', 'web', 'browser', 'internet', 'rss', 'youtube', 'reddit', 'twitter', 'github search'] },
  { category: '自动化与扩展', words: ['automation', 'workflow', 'mcp', 'plugin', 'agent', 'hook', 'scaffold'] },
  { category: '开发与工程', words: ['code', 'coding', 'developer', 'typescript', 'javascript', 'python', 'git', 'build', 'ci', 'merge', 'api', 'cli', 'engineering'] },
];

const tagRules: { tag: SkillTag; words: string[] }[] = [
  { tag: 'AI 与模型', words: ['ai', 'gpt', 'llm', 'model', 'prompt', 'agent', 'machine learning', 'automl'] },
  { tag: '代码', words: ['code', 'coding', 'developer', 'typescript', 'javascript', 'python', 'git', 'api', 'cli'] },
  { tag: '测试', words: ['test', 'testing', 'debug', 'diagnos', 'lint', 'review', 'quality', 'playwright'] },
  { tag: '前端', words: ['ui', 'ux', 'frontend', 'front-end', 'react', 'next', 'css', 'web'] },
  { tag: '设计', words: ['design', 'visual', 'ui', 'ux', 'image', 'presentation'] },
  { tag: '文档', words: ['document', 'writing', 'article', 'content', 'markdown', 'pdf', 'presentation', 'spreadsheet'] },
  { tag: '研究', words: ['research', 'kaggle', 'experiment', 'analysis', 'machine learning'] },
  { tag: '数据', words: ['data', 'sql', 'spreadsheet', 'kaggle', 'analysis'] },
  { tag: '联网', words: ['search', 'social', 'web', 'browser', 'internet', 'rss', 'youtube', 'reddit', 'twitter'] },
  { tag: '自动化', words: ['automation', 'workflow', 'agent', 'hook', 'scaffold', 'ci'] },
  { tag: '插件', words: ['plugin', 'mcp', '.codex-plugin'] },
];

function searchable(input: TaxonomyInput) {
  return [input.name, input.description, input.relativePath, input.repository, input.scope]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matches(text: string, words: string[]) {
  const tokens = text ? text.split(/\s+/) : [];
  return words.some((word) => {
    const normalized = word.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (normalized.includes(' ')) return ` ${text} `.includes(` ${normalized} `);
    return tokens.some((token) =>
      normalized.length <= 3 ? token === normalized : token === normalized || token.startsWith(normalized),
    );
  });
}

export function classifySkill(input: TaxonomyInput): { category: SkillCategory; tags: SkillTag[] } {
  const text = searchable(input);
  const category = categoryRules.find((rule) => matches(text, rule.words))?.category ?? '其他';
  const tags = tagRules.filter((rule) => matches(text, rule.words)).map((rule) => rule.tag);
  if (input.scope === 'plugin' && !tags.includes('插件')) tags.push('插件');
  if (input.scope === 'system' || input.scope === 'user' || input.scope === 'project') {
    if (text.includes('codex') && !tags.includes('Codex')) tags.unshift('Codex');
  }
  return { category, tags };
}
