import { z } from 'zod';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { TranslationBlock } from '@/shared/types';

export const translationResponseSchema = z
  .object({
    segments: z.array(z.object({ id: z.string(), text: z.string().min(1) }).strict()).max(16000),
  })
  .strict();

export function prepareTranslation(source: string) {
  const lines = source.split(/\r?\n/);
  const segments: { id: string; text: string; prefix: string; line: number }[] = [];
  let fence: { char: string; length: number } | null = null;
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    const marker = text.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length };
      else if (
        marker[1][0] === fence.char &&
        marker[1].length >= fence.length &&
        !text.slice(marker[0].length).trim()
      )
        fence = null;
      continue;
    }
    if (fence || !text.trim() || /^\s*https?:\/\/\S+\s*$/.test(text)) continue;
    const match = text.match(/^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)?)(.*)$/)!;
    if (!match[2]) continue;
    segments.push({ id: `l${line}`, text: match[2], prefix: match[1], line });
  }
  return { lines, segments };
}

export function assembleTranslation(value: unknown, plan: ReturnType<typeof prepareTranslation>) {
  const { segments } = translationResponseSchema.parse(value);
  const expected = new Set(plan.segments.map((segment) => segment.id));
  const translated = new Map<string, string>();
  for (const segment of segments) {
    if (!expected.has(segment.id) || translated.has(segment.id))
      throw new Error('译文段落编号不匹配');
    translated.set(segment.id, segment.text.trim());
  }
  if (translated.size !== expected.size) throw new Error('译文缺少原文段落');
  const lines = [...plan.lines];
  for (const segment of plan.segments) {
    const text = translated.get(segment.id)!;
    if (!text) throw new Error('译文段落为空');
    const prose = (value: string) => value.replace(/`[^`\n]*`|https?:\/\/\S+/g, '');
    if (
      /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(prose(segment.text)) &&
      !/[\u4e00-\u9fff]/.test(prose(text))
    )
      throw new Error('译文段落未使用中文');
    const hardBreak = plan.lines[segment.line].match(/ {2,}$/)?.[0] ?? '';
    lines[segment.line] = segment.prefix + text + hardBreak;
  }
  return lines.join('\n');
}

// Pair using the validated model IDs, never by guessing paragraph positions in a legacy string.
export function buildTranslationBlocks(
  value: unknown,
  plan: ReturnType<typeof prepareTranslation>,
): TranslationBlock[] {
  assembleTranslation(value, plan);
  const translated = new Map(
    translationResponseSchema.parse(value).segments.map((s) => [s.id, s.text.trim()]),
  );
  const segments = new Map(plan.segments.map((s) => [s.line, s]));
  const source = plan.lines.join('\n');
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
  // Reference links and footnotes can depend on definitions anywhere in the document.
  // Keep their full parsing context instead of inventing independent fragments.
  type Node = { type: string; children?: Node[] };
  const hasDefinition = (node: Node): boolean =>
    node.type === 'definition' ||
    node.type === 'footnoteDefinition' ||
    !!node.children?.some(hasDefinition);
  if (hasDefinition(tree)) {
    return [{ original: source, translation: assembleTranslation(value, plan) }];
  }
  return tree.children.map((node) => {
    const start = node.position!.start.line - 1;
    const end = node.position!.end.line;
    const original = plan.lines.slice(start, end);
    let hasTranslation = false;
    const chinese = original.map((line, offset) => {
      const segment = segments.get(start + offset);
      if (!segment) return line;
      hasTranslation = true;
      return segment.prefix + translated.get(segment.id)! + (line.match(/ {2,}$/)?.[0] ?? '');
    });
    return {
      original: original.join('\n'),
      translation: hasTranslation ? chinese.join('\n') : null,
    };
  });
}
