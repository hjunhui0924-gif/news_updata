import { createHash } from 'node:crypto';
import type { FeedItem, FeedPreview } from '@/shared/types';
import { getConfig } from '../config';

export const promptVersions = {
  summary: '2026-09-13-v2-zh-complete',
  translation: '2026-09-13-v4-bilingual',
} as const;

export function artifactVersions(config = getConfig()) {
  return Object.fromEntries(
    (['summary', 'translation'] as const).map((kind) => [
      kind,
      createHash('sha256')
        .update(
          JSON.stringify({
            kind,
            language: 'zh-CN',
            prompt: promptVersions[kind],
            model: config.LLM_MODEL,
            baseUrl: config.LLM_API_BASE_URL,
            thinking: config.LLM_ENABLE_THINKING,
          }),
        )
        .digest('hex'),
    ]),
  ) as Record<'summary' | 'translation', string>;
}

// A disabled provider can still display historical artifacts. Reading never queues paid work.
export function currentArtifactVersions() {
  const config = getConfig();
  return config.LLM_ENABLED === 'true' ? artifactVersions(config) : null;
}

export function withCurrentArtifacts<T extends FeedItem | FeedPreview>(
  item: T,
  versions: ReturnType<typeof currentArtifactVersions>,
): T {
  if (!versions || item.demo) return item;
  const next = { ...item };
  if (item.summary && item.aiVersions?.summary !== versions.summary) {
    next.summary = null;
    if (next.aiStatus !== 'pending') next.aiStatus = 'failed';
    if ('body' in next) next.aiError = '模型配置或提示词已更新，请手动重新生成；原文仍可阅读。';
  }
  if (
    'translation' in next &&
    (next.translation || next.translationBlocks?.length) &&
    item.language !== 'zh' &&
    item.aiVersions?.translation !== versions.translation
  ) {
    next.translation = null;
    next.translationBlocks = null;
  }
  return next;
}
