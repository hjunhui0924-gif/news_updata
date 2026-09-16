import { z } from 'zod';
import { getPool } from '../db/client';
import { GitHubError } from '../connectors/github';
import { createUserGitHubConnector } from '../connectors/github-user';
import type { SkillCatalogPage, SkillDetails, SkillSummary } from '@/shared/skills';
import {
  getDefaultLocalSkillRoots,
  getLocalSkill,
  scanLocalSkills,
  type LocalSkillRecord,
  type LocalSkillRoot,
} from './local';
import {
  getStarredSkill,
  listStarredSkills,
  type GitHubSkillClient,
  type StarredSkillPage,
} from './github';

export type UserGitHubSkillClient = {
  username: string;
  client: GitHubSkillClient;
};

export type SkillServiceDependencies = {
  roots?: LocalSkillRoot[];
  resolveGitHub?: (userId: string, signal?: AbortSignal) => Promise<UserGitHubSkillClient>;
};

const detailIdSchema = z.string().trim().min(1).max(1000);

function publicSkill(skill: LocalSkillRecord): SkillSummary {
  return {
    id: skill.id,
    source: skill.source,
    scope: skill.scope,
    name: skill.name,
    description: skill.description,
    relativePath: skill.relativePath,
    location: skill.location,
    repository: skill.repository,
    repositoryDescription: skill.repositoryDescription,
    repositoryUrl: skill.repositoryUrl,
    url: skill.url,
    updatedAt: skill.updatedAt,
    files: skill.files,
  };
}

function localRoots(dependencies?: SkillServiceDependencies) {
  return dependencies?.roots ?? getDefaultLocalSkillRoots();
}

async function resolveGitHub(
  userId: string,
  signal?: AbortSignal,
): Promise<UserGitHubSkillClient> {
  const { rows } = await getPool().query(
    'SELECT "accountId" FROM account WHERE "userId"=$1 AND "providerId"=$2',
    [userId, 'github'],
  );
  const accountId: string | undefined = rows[0]?.accountId;
  if (!accountId) throw new GitHubError('请先使用 GitHub 登录后查看你的 Star Skill。', 401);
  const client = await createUserGitHubConnector(userId, signal);
  return { username: await client.usernameById(accountId), client };
}

async function githubClient(
  userId: string,
  signal: AbortSignal | undefined,
  dependencies?: SkillServiceDependencies,
) {
  return (dependencies?.resolveGitHub ?? resolveGitHub)(userId, signal);
}

export async function listLocalSkillCatalog(
  dependencies?: SkillServiceDependencies,
): Promise<SkillCatalogPage> {
  const skills = await scanLocalSkills(localRoots(dependencies));
  return { skills: skills.map(publicSkill), nextPage: null, truncated: false };
}

export async function getLocalSkillDetails(
  id: string,
  dependencies?: SkillServiceDependencies,
): Promise<SkillDetails | null> {
  const skill = await getLocalSkill(detailIdSchema.parse(id), localRoots(dependencies));
  return skill ? { ...publicSkill(skill), content: skill.content } : null;
}

export async function listUserStarredSkillCatalog(
  userId: string,
  page: number,
  signal?: AbortSignal,
  dependencies?: SkillServiceDependencies,
): Promise<SkillCatalogPage> {
  const resolved = await githubClient(userId, signal, dependencies);
  const result: StarredSkillPage = await listStarredSkills(
    resolved.username,
    page,
    resolved.client,
  );
  return {
    skills: result.skills,
    nextPage: result.nextPage,
    truncated: result.truncated,
    username: result.username,
  };
}

function parseGitHubSkillId(id: string) {
  const value = detailIdSchema.parse(id);
  if (!value.startsWith('github:')) return null;
  const rest = value.slice('github:'.length);
  const separator = rest.indexOf(':');
  if (separator < 1 || separator === rest.length - 1) return null;
  return { repository: rest.slice(0, separator), filePath: rest.slice(separator + 1) };
}

export async function getUserSkillDetails(
  userId: string,
  id: string,
  signal?: AbortSignal,
  dependencies?: SkillServiceDependencies,
): Promise<SkillDetails | null> {
  const parsed = parseGitHubSkillId(id);
  if (!parsed) return getLocalSkillDetails(id, dependencies);
  const resolved = await githubClient(userId, signal, dependencies);
  return getStarredSkill(resolved.username, parsed.repository, parsed.filePath, resolved.client);
}
