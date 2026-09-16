import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSkillMetadata } from '../src/server/skills/metadata';
import { getLocalSkill, scanLocalSkills, type LocalSkillRoot } from '../src/server/skills/local';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Skill metadata', () => {
  it('parses quoted scalar metadata', () => {
    expect(
      parseSkillMetadata('---\nname: "prompt-tools"\ndescription: Help with prompts\n---\n# Body'),
    ).toEqual({ name: 'prompt-tools', description: 'Help with prompts' });
  });

  it('parses literal and folded descriptions', () => {
    expect(
      parseSkillMetadata('---\nname: prose\ndescription: |\n  First line\n  Second line\n---'),
    ).toEqual({ name: 'prose', description: 'First line\nSecond line' });
    expect(
      parseSkillMetadata('---\nname: prose\ndescription: >\n  First line\n  Second line\n---'),
    ).toEqual({ name: 'prose', description: 'First line Second line' });
  });

  it('rejects documents without the required contract', () => {
    expect(parseSkillMetadata('# no frontmatter')).toBeNull();
    expect(parseSkillMetadata('---\nname: only-name\n---')).toBeNull();
    expect(parseSkillMetadata('---\ndescription: only-description\n---')).toBeNull();
  });
});

describe('local Skill scanner', () => {
  async function createRoot() {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'news-updata-skills-'));
    temporaryDirectories.push(rootPath);
    const root: LocalSkillRoot = { id: 'test', path: rootPath, label: '测试目录', scope: 'user' };
    return { root, rootPath };
  }

  it('finds valid skills, exposes capability flags, and ignores invalid documents', async () => {
    const { root, rootPath } = await createRoot();
    await mkdir(path.join(rootPath, 'good', 'scripts'), { recursive: true });
    await mkdir(path.join(rootPath, 'good', 'references'), { recursive: true });
    await mkdir(path.join(rootPath, 'good', 'assets'), { recursive: true });
    await mkdir(path.join(rootPath, 'good', 'agents'), { recursive: true });
    await writeFile(
      path.join(rootPath, 'good', 'SKILL.md'),
      '---\nname: good-skill\ndescription: A useful local workflow\n---\n# Good',
    );
    await mkdir(path.join(rootPath, 'bad'));
    await writeFile(path.join(rootPath, 'bad', 'SKILL.md'), '---\nname: missing-description\n---');
    await mkdir(path.join(rootPath, 'nested', 'child'), { recursive: true });
    await writeFile(
      path.join(rootPath, 'nested', 'child', 'SKILL.md'),
      '---\nname: nested-skill\ndescription: Nested workflow\n---',
    );
    await writeFile(path.join(rootPath, 'good', 'agents', 'openai.yaml'), 'interface:\n  display_name: Good');

    const skills = await scanLocalSkills([root]);
    expect(skills.map((skill) => skill.name)).toEqual(['good-skill', 'nested-skill']);
    expect(skills[0]).toMatchObject({
      id: 'local:test:good/SKILL.md',
      location: '测试目录',
      files: { scripts: true, references: true, assets: true, interface: true },
    });
  });

  it('reads details only by an id returned from the scan', async () => {
    const { root, rootPath } = await createRoot();
    await mkdir(path.join(rootPath, 'one'));
    await writeFile(
      path.join(rootPath, 'one', 'SKILL.md'),
      '---\nname: one\ndescription: One workflow\n---\n\n# Full instructions',
    );
    const [summary] = await scanLocalSkills([root]);
    await expect(getLocalSkill(summary.id, [root])).resolves.toMatchObject({
      name: 'one',
      content: expect.stringContaining('# Full instructions'),
    });
    await expect(getLocalSkill('local:test:../outside/SKILL.md', [root])).resolves.toBeNull();
  });
});
