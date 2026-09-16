import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitHubSkillClient } from '../src/server/skills/github';
import type { SkillAiState } from '../src/shared/skills';
import {
  getLocalSkillDetails,
  getUserSkillDetails,
  listLocalSkillCatalog,
  listUserStarredSkillCatalog,
  type SkillServiceDependencies,
} from '../src/server/skills/service';

const temporaryDirectories: string[] = [];
const emptyAi: SkillAiState = {
  summary: null,
  translation: null,
  summaryStatus: 'idle',
  translationStatus: 'idle',
  summaryError: null,
  translationError: null,
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function localDependencies() {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'news-updata-service-'));
  temporaryDirectories.push(rootPath);
  await mkdir(path.join(rootPath, 'one'));
  await writeFile(
    path.join(rootPath, 'one', 'SKILL.md'),
    '---\nname: one\ndescription: One local skill\n---\n# Local details',
  );
  return {
    rootPath,
    dependencies: {
      roots: [{ id: 'test', path: rootPath, label: '测试目录', scope: 'user' as const }],
    } satisfies SkillServiceDependencies,
  };
}

describe('SkillCatalog service', () => {
  it('returns public local summaries without leaking filesystem paths', async () => {
    const { dependencies } = await localDependencies();
    const catalog = await listLocalSkillCatalog(dependencies);
    expect(catalog).toMatchObject({ nextPage: null, truncated: false });
    expect(catalog.skills[0]).toMatchObject({ name: 'one', location: '测试目录' });
    expect(catalog.skills[0]).not.toHaveProperty('filePath');
    expect(catalog.skills[0]).not.toHaveProperty('rootId');
    const withAi = {
      ...dependencies,
      getAiState: vi.fn(async () => emptyAi),
    };
    await expect(getLocalSkillDetails('user-1', catalog.skills[0].id, withAi)).resolves.toMatchObject({
      content: expect.stringContaining('# Local details'),
      contentHash: expect.any(String),
    });
  });

  it('uses one GitHub resolver for both listing and details', async () => {
    const starred = vi.fn(async () => ({
      repositories: [{ id: '1', name: 'owner/repo', description: 'Repo', url: 'https://github.com/owner/repo' }],
      nextPage: null,
    }));
    const tree = vi.fn(async () => ({
      branch: 'main',
      truncated: false,
      tree: [{ path: 'SKILL.md', type: 'blob' }],
    }));
    const readFile = vi.fn(async () => '---\nname: remote\ndescription: Remote skill\n---\n# Remote');
    const client: GitHubSkillClient = { starred, repositoryTree: tree, readFile };
    const dependencies: SkillServiceDependencies = {
      resolveGitHub: vi.fn(async () => ({ username: 'alice', client })),
      getAiState: vi.fn(async () => emptyAi),
    };
    const catalog = await listUserStarredSkillCatalog('user-1', 1, undefined, dependencies);
    expect(catalog.skills[0]).toMatchObject({ name: 'remote', repository: 'owner/repo' });
    await expect(getUserSkillDetails('user-1', catalog.skills[0].id, undefined, dependencies)).resolves.toMatchObject({
      content: expect.stringContaining('# Remote'),
    });
    expect(dependencies.resolveGitHub).toHaveBeenCalledTimes(2);
    expect(starred).toHaveBeenCalledWith('alice', 1);
  });

  it('does not treat malformed GitHub ids as local paths', async () => {
    const { dependencies } = await localDependencies();
    await expect(getUserSkillDetails('user-1', 'github:invalid', undefined, {
      ...dependencies,
      getAiState: vi.fn(async () => emptyAi),
    })).resolves.toBeNull();
  });
});
