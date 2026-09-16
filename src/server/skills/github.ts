import { GitHubError, GitHubConnector } from '../connectors/github';
import { parseSkillMetadata } from './metadata';
import type { SkillDocument, SkillFiles, SkillSummary } from '@/shared/skills';
import { classifySkill } from '@/shared/skill-taxonomy';

type StarredRepository = Awaited<ReturnType<GitHubConnector['starred']>>['repositories'][number];
type RepositoryTree = Awaited<ReturnType<GitHubConnector['repositoryTree']>>;

export type GitHubSkillClient = {
  starred(input: string, page?: number): Promise<{
    repositories: StarredRepository[];
    nextPage: number | null;
  }>;
  repositoryTree(repo: string): Promise<RepositoryTree>;
  readFile(repo: string, filePath: string): Promise<string | null>;
};

export type StarredSkillPage = {
  username: string;
  page: number;
  skills: SkillSummary[];
  nextPage: number | null;
  truncated: boolean;
};

function isSkillPath(filePath: string) {
  if (filePath === 'SKILL.md') return true;
  return (
    (filePath.startsWith('skills/') || filePath.startsWith('.agents/skills/')) &&
    filePath.endsWith('/SKILL.md')
  );
}

function skillDirectory(filePath: string) {
  const index = filePath.lastIndexOf('/');
  return index < 0 ? '' : filePath.slice(0, index);
}

function fileFlags(tree: RepositoryTree['tree'], directory: string): SkillFiles {
  const prefix = directory ? `${directory}/` : '';
  const paths = new Set(tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path));
  const hasDirectory = (name: string) => [...paths].some((value) => value.startsWith(`${prefix}${name}/`));
  return {
    scripts: hasDirectory('scripts'),
    references: hasDirectory('references'),
    assets: hasDirectory('assets'),
    interface: paths.has(`${prefix}agents/openai.yaml`),
  };
}

function summary(
  repository: StarredRepository,
  path: string,
  metadata: { name: string; description: string },
  tree: RepositoryTree['tree'],
): SkillSummary {
  const directory = skillDirectory(path);
  const taxonomy = classifySkill({
    name: metadata.name,
    description: metadata.description,
    relativePath: path,
    repository: repository.name,
    scope: 'github',
  });
  return {
    id: `github:${repository.name}:${path}`,
    source: 'github',
    scope: 'github',
    name: metadata.name,
    description: metadata.description,
    relativePath: path,
    location: 'GitHub Star',
    repository: repository.name,
    repositoryDescription: repository.description,
    repositoryUrl: repository.url,
    url: `${repository.url}/blob/HEAD/${path}`,
    updatedAt: null,
    files: fileFlags(tree, directory),
    ...taxonomy,
  };
}

async function concurrent<T, R>(values: T[], limit: number, work: (value: T) => Promise<R>) {
  const result: R[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await work(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return result;
}

export async function listStarredSkills(
  username: string,
  page = 1,
  client: GitHubSkillClient = new GitHubConnector(),
): Promise<StarredSkillPage> {
  const starred = await client.starred(username, page);
  const repositoryResults = await concurrent(starred.repositories, 4, async (repository) => {
    const repositoryTree = await client.repositoryTree(repository.name);
    const paths = repositoryTree.tree
      .filter((entry) => entry.type === 'blob' && isSkillPath(entry.path))
      .map((entry) => entry.path);
    const records = await concurrent(paths.slice(0, 20), 4, async (filePath) => {
      const content = await client.readFile(repository.name, filePath);
      const metadata = content ? parseSkillMetadata(content) : null;
      return metadata ? summary(repository, filePath, metadata, repositoryTree.tree) : null;
    });
    return { records, truncated: repositoryTree.truncated };
  });
  return {
    username,
    page,
    skills: repositoryResults.flatMap((result) => result.records.filter((value): value is SkillSummary => !!value)),
    nextPage: starred.nextPage,
    truncated: repositoryResults.some((result) => result.truncated),
  };
}

export async function getStarredSkill(
  username: string,
  repository: string,
  filePath: string,
  client: GitHubSkillClient = new GitHubConnector(),
): Promise<SkillDocument | null> {
  let page = 1;
  let repositoryInfo: StarredRepository | undefined;
  while (page <= 10000 && !repositoryInfo) {
    const starred = await client.starred(username, page);
    repositoryInfo = starred.repositories.find(
      (item) => item.name.toLowerCase() === repository.toLowerCase(),
    );
    if (repositoryInfo || !starred.nextPage) break;
    page = starred.nextPage;
  }
  if (!repositoryInfo) throw new GitHubError('这个项目不在当前 GitHub Star 列表中。', 404);
  const content = await client.readFile(repository, filePath);
  const metadata = content ? parseSkillMetadata(content) : null;
  if (!content || !metadata) return null;
  const tree = await client.repositoryTree(repository);
  return { ...summary(repositoryInfo, filePath, metadata, tree.tree), content };
}
