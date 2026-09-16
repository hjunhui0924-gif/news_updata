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
};

export type SkillDetails = SkillSummary & {
  content: string;
};

export type SkillCatalogPage = {
  skills: SkillSummary[];
  nextPage: number | null;
  truncated: boolean;
  username?: string;
};
