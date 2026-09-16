import type { TranslationBlock } from './types';
import type { SkillCategory, SkillTag } from './skill-taxonomy';

export type SkillSource = 'local' | 'github';
export type SkillScope = 'project' | 'user' | 'system' | 'plugin' | 'github';

export type SkillFiles = {
  scripts: boolean;
  references: boolean;
  assets: boolean;
  interface: boolean;
};

export type SkillSummary = {
  id: string;
  source: SkillSource;
  scope: SkillScope;
  name: string;
  description: string;
  relativePath: string;
  location: string;
  repository?: string;
  repositoryDescription?: string;
  repositoryUrl?: string;
  url?: string;
  updatedAt: string | null;
  files: SkillFiles;
  category: SkillCategory;
  tags: SkillTag[];
};

export type SkillDocument = SkillSummary & {
  content: string;
};
export type SkillDetails = SkillDocument & {
  contentHash: string;
  ai: SkillAiState;
};

export type SkillCatalogPage = {
  skills: SkillSummary[];
  nextPage: number | null;
  truncated: boolean;
  username?: string;
};

export type SkillAiStatus = 'idle' | 'pending' | 'ready' | 'disabled' | 'failed';
export type SkillAiSummary = {
  headline: string;
  overview: string;
  scenarios: string[];
  workflow: string[];
  cautions: string[];
  evidence: { id: string; text: string }[];
};
export type SkillAiTranslation = {
  text: string;
  blocks: TranslationBlock[];
};
export type SkillAiState = {
  summary: SkillAiSummary | null;
  translation: SkillAiTranslation | null;
  summaryStatus: SkillAiStatus;
  translationStatus: SkillAiStatus;
  summaryError: string | null;
  translationError: string | null;
};
