import { expect, it } from 'vitest';
import { prepareTranslation, assembleTranslation } from '../src/server/ai/translation';
it('rejects translated headings with copied English paragraphs and preserves Markdown hard breaks', () => {
  const plan = prepareTranslation('## Improvements\n\nBug fixes.  \nFaster loading.');
  expect(() =>
    assembleTranslation(
      {
        segments: [
          { id: 'l0', text: '改进' },
          { id: 'l2', text: 'Bug fixes.' },
          { id: 'l3', text: 'Faster loading.' },
        ],
      },
      plan,
    ),
  ).toThrow('中文');
  expect(
    assembleTranslation(
      {
        segments: [
          { id: 'l0', text: '改进' },
          { id: 'l2', text: '修复错误。' },
          { id: 'l3', text: '加载更快。' },
        ],
      },
      plan,
    ),
  ).toBe('## 改进\n\n修复错误。  \n加载更快。');
});
it('restores source order, headings, lists, blank lines and code even when model segments are reordered', () => {
  const plan = prepareTranslation(
    '## Changes\n\n- Bug fixes.\n  1. Faster loading.\n```html\n<br>\n- literal\n```\nhttps://example.com',
  );
  expect(plan.segments.map((s) => s.id)).toEqual(['l0', 'l2', 'l3']);
  expect(
    assembleTranslation(
      {
        segments: [
          { id: 'l3', text: '加载更快。' },
          { id: 'l2', text: '修复错误。' },
          { id: 'l0', text: '更新' },
        ],
      },
      plan,
    ),
  ).toBe(
    '## 更新\n\n- 修复错误。\n  1. 加载更快。\n```html\n<br>\n- literal\n```\nhttps://example.com',
  );
});
it('rejects missing, duplicate, unknown and empty translated segments', () => {
  const plan = prepareTranslation('Bug fixes.\nFaster loading.');
  for (const segments of [
    [],
    [{ id: 'l0', text: '修复。' }],
    [
      { id: 'l0', text: '修复。' },
      { id: 'l0', text: '重复。' },
    ],
    [
      { id: 'l0', text: '修复。' },
      { id: 'l9', text: '其他。' },
    ],
    [
      { id: 'l0', text: '修复。' },
      { id: 'l1', text: ' ' },
    ],
  ])
    expect(() => assembleTranslation({ segments }, plan)).toThrow();
});
