import { describe, expect, it, vi } from 'vitest';
import type { GitHubSkillClient } from '../src/server/skills/github';
import { listStarredSkills } from '../src/server/skills/github';
import { GitHubConnector, GitHubError } from '../src/server/connectors/github';

const repo = {
  id: '1',
  name: 'owner/skill-pack',
  description: 'A collection of agent skills',
  url: 'https://github.com/owner/skill-pack',
};
const valid = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# Instructions`;

function client(): GitHubSkillClient {
  return {
    starred: vi.fn(async () => ({ repositories: [repo], nextPage: 2 })),
    repositoryTree: vi.fn(async () => ({
      branch: 'main',
      truncated: false,
      tree: [
        { path: 'SKILL.md', type: 'blob' },
        { path: 'scripts/run.ts', type: 'blob' },
        { path: 'skills/reviewer/SKILL.md', type: 'blob' },
        { path: 'skills/reviewer/references/guide.md', type: 'blob' },
        { path: 'README.md', type: 'blob' },
      ],
    })),
    readFile: vi.fn(async (_repo, filePath) =>
      filePath === 'SKILL.md' ? valid('pack', 'Review code') : valid('reviewer', 'Review changes'),
    ),
  };
}

describe('GitHub Star Skill adapter', () => {
  it('detects root and collection skills, preserves repository context, and exposes files', async () => {
    const result = await listStarredSkills('alice', 1, client());
    expect(result).toMatchObject({ username: 'alice', page: 1, nextPage: 2, truncated: false });
    expect(result.skills.map((skill) => skill.name)).toEqual(['pack', 'reviewer']);
    expect(result.skills[0]).toMatchObject({
      source: 'github',
      repository: 'owner/skill-pack',
      repositoryUrl: 'https://github.com/owner/skill-pack',
      files: { scripts: true, references: false, assets: false, interface: false },
    });
    expect(result.skills[1].files.references).toBe(true);
  });

  it('skips files that do not satisfy the SKILL.md metadata contract', async () => {
    const input = client();
    input.readFile = vi.fn(async () => '---\nname: invalid\n---');
    const result = await listStarredSkills('alice', 1, input);
    expect(result.skills).toEqual([]);
  });

  it('keeps GitHub rate-limit failures visible', async () => {
    const input = client();
    input.repositoryTree = vi.fn(async () => {
      throw new GitHubError('limited', 429);
    });
    await expect(listStarredSkills('alice', 1, input)).rejects.toThrow('limited');
  });
});

describe('GitHub skill file connector', () => {
  it('reads a base64 file and rejects traversal paths', async () => {
    const paths: string[] = [];
    const connector = new GitHubConnector(async (path) => {
      paths.push(path);
      if (path === '/repos/owner/pack') return { data: { default_branch: 'main' }, hasNext: false };
      return {
        data: {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from('---\nname: pack\ndescription: Pack\n---').toString('base64'),
        },
        hasNext: false,
      };
    });
    await expect(connector.readFile('owner/pack', 'skills/my skill/SKILL.md')).resolves.toContain(
      'name: pack',
    );
    expect(paths).toEqual(['/repos/owner/pack/contents/skills/my%20skill/SKILL.md']);
    await expect(connector.readFile('owner/pack', '../SKILL.md')).rejects.toThrow('路径');
  });
});
