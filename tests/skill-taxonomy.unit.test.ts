import { describe, expect, it } from 'vitest';
import { classifySkill, skillCategories, skillTags } from '../src/shared/skill-taxonomy';

describe('Skill taxonomy', () => {
  it('classifies development, testing, and plugin skills consistently', () => {
    expect(
      classifySkill({
        name: 'playwright-e2e',
        description: 'Debug browser tests and inspect UI regressions.',
        relativePath: 'playwright-e2e/SKILL.md',
        scope: 'user',
      }),
    ).toMatchObject({ category: '测试与质量', tags: expect.arrayContaining(['测试']) });
    expect(
      classifySkill({
        name: 'openai-docs',
        description: 'Use MCP to search API documentation and build integrations.',
        relativePath: 'openai-docs/SKILL.md',
        scope: 'plugin',
      }),
    ).toMatchObject({ category: '文档与内容', tags: expect.arrayContaining(['联网', '插件']) });
  });

  it('keeps unknown skills in a visible fallback category', () => {
    expect(
      classifySkill({
        name: 'quiet-helper',
        description: 'A small private routine.',
        relativePath: 'quiet-helper/SKILL.md',
      }),
    ).toEqual({ category: '其他', tags: [] });
    expect(skillCategories).toContain('其他');
    expect(skillTags).toContain('代码');
  });
});
