import { expect, it } from 'vitest';
import {
  prepareTranslation,
  assembleTranslation,
  buildTranslationBlocks,
} from '../src/server/ai/translation';

it('preserves loose list numbering and cross-paragraph reference context', () => {
  const list = '1. First step.\n\n1. Second step.';
  expect(
    buildTranslationBlocks(
      {
        segments: [
          { id: 'l0', text: '第一步。' },
          { id: 'l2', text: '第二步。' },
        ],
      },
      prepareTranslation(list),
    ),
  ).toEqual([{ original: list, translation: '1. 第一步。\n\n1. 第二步。' }]);
  const reference = 'Read the [guide][docs].\n\n[docs]: https://example.com/guide';
  expect(
    buildTranslationBlocks(
      {
        segments: [
          { id: 'l0', text: '阅读[指南][docs]。' },
          { id: 'l2', text: '[docs]: https://example.com/guide' },
        ],
      },
      prepareTranslation(reference),
    ),
  ).toEqual([
    { original: reference, translation: '阅读[指南][docs]。\n\n[docs]: https://example.com/guide' },
  ]);
});

it('retains full context for reference definitions nested in blockquotes', () => {
  const source = 'Read the [guide][docs].\n\n> [docs]: https://example.com/guide';
  const blocks = buildTranslationBlocks(
    {
      segments: [
        { id: 'l0', text: '阅读[指南][docs]。' },
        { id: 'l2', text: '[docs]: https://example.com/guide' },
      ],
    },
    prepareTranslation(source),
  );
  expect(blocks).toEqual([
    { original: source, translation: '阅读[指南][docs]。\n\n> [docs]: https://example.com/guide' },
  ]);
});

it('pairs source blocks by segment IDs even when translations contain extra newlines, preserving code once', () => {
  const source =
    '## Changes\n\nFirst paragraph.\nSecond line.\n\n```js\nconst x = 1;\n\nconsole.log(x);\n```\n\n- Faster loading.\n- Bug fixes.';
  const blocks = buildTranslationBlocks(
    {
      segments: [
        { id: 'l12', text: '修复错误。' },
        { id: 'l11', text: '加载更快。' },
        { id: 'l3', text: '第二行。' },
        { id: 'l2', text: '第一段。\n补充换行。' },
        { id: 'l0', text: '变化' },
      ],
    },
    prepareTranslation(source),
  );
  expect(blocks).toEqual([
    { original: '## Changes', translation: '## 变化' },
    { original: 'First paragraph.\nSecond line.', translation: '第一段。\n补充换行。\n第二行。' },
    { original: '```js\nconst x = 1;\n\nconsole.log(x);\n```', translation: null },
    { original: '- Faster loading.\n- Bug fixes.', translation: '- 加载更快。\n- 修复错误。' },
  ]);
});
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
