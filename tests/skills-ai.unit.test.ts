import { describe, expect, it } from 'vitest';
import {
  buildDemoSkillSummary,
  skillAiCacheKey,
  skillContentHash,
  skillEvidence,
  validateSkillSummary,
} from '../src/server/skills/ai';

const detail = {
  id: 'local:test:reviewer/SKILL.md',
  name: 'reviewer',
  description: 'Review code changes with a repeatable workflow.',
  content: `---
name: reviewer
description: Review code changes with a repeatable workflow.
---

# Reviewer

## When to use

Use this workflow for code review requests.

## Steps

1. Inspect the diff.
2. Verify the tests.
`,
};

describe('Skill AI contracts', () => {
  it('creates bounded evidence and a deterministic demo summary', () => {
    const evidence = skillEvidence(detail.content);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].id).toBe('k1');
    expect(evidence.every((item) => item.text.length <= 1000)).toBe(true);
    expect(buildDemoSkillSummary(detail)).toMatchObject({
      headline: 'reviewer 的使用说明',
      scenarios: expect.arrayContaining([expect.stringContaining('When to use')]),
      evidence: expect.arrayContaining([expect.objectContaining({ id: 'k1' })]),
    });
  });

  it('accepts Chinese structured summaries only when evidence ids are valid', () => {
    const evidence = [{ id: 'k1', text: '适用于代码审查工作流。' }];
    const valid = {
      headline: '代码审查助手',
      overview: '帮助团队按固定步骤检查代码变更。',
      scenarios: ['适合提交代码审查请求时使用。'],
      workflow: ['先阅读变更，再运行测试。'],
      cautions: ['仍需人工确认最终结论。'],
      evidence: evidence,
    };
    expect(validateSkillSummary(valid, evidence)).toEqual(valid);
    expect(() => validateSkillSummary({ ...valid, evidence: [{ id: 'missing', text: '依据' }] }, evidence)).toThrow(
      '不存在',
    );
    expect(() => validateSkillSummary({ ...valid, overview: 'Review code changes' }, evidence)).toThrow(
      '中文',
    );
  });

  it('changes the cache key when the Skill content changes', () => {
    const first = { id: detail.id, contentHash: skillContentHash(detail.content) };
    const second = { id: detail.id, contentHash: skillContentHash(`${detail.content}\nnew`) };
    expect(first.contentHash).not.toBe(second.contentHash);
    expect(skillAiCacheKey(first, 'summary')).not.toBe(skillAiCacheKey(second, 'summary'));
    expect(skillAiCacheKey(first, 'summary')).not.toBe(skillAiCacheKey(first, 'translation'));
  });
});
