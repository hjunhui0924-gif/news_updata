import { expect, it } from 'vitest';
import { artifactVersions, withCurrentArtifacts } from '../src/server/ai/artifact-version';
import { getConfig } from '../src/server/config';
import { createDemoData } from '../src/server/demo/fixtures';
import { toFeedPreview } from '../src/shared/feed';

it('binds each kind to model, provider, thinking, target language and prompt versions', () => {
  const config = getConfig();
  const first = artifactVersions(config);
  for (const change of [
    { LLM_MODEL: 'next' },
    { LLM_API_BASE_URL: 'https://next.invalid' },
    { LLM_ENABLE_THINKING: 'true' as const },
  ]) {
    expect(artifactVersions({ ...config, ...change })).not.toEqual(first);
  }
  expect(first.summary).not.toBe(first.translation);
  expect(JSON.stringify(first)).not.toContain(config.LLM_API_KEY || 'never-included-secret');
});

it('hides stale and unversioned real artifacts consistently without mutating stored data', () => {
  const versions = artifactVersions();
  const item = {
    ...createDemoData().items[0],
    demo: false,
    language: 'en' as const,
    translation: '旧译文',
    translationBlocks: [{ original: 'original', translation: '旧译文' }],
    aiVersions: { summary: 'old', translation: 'old' },
  };
  const current = withCurrentArtifacts(item, versions);
  expect(current.summary).toBeNull();
  expect(current.translation).toBeNull();
  expect(current.translationBlocks).toBeNull();
  expect(current.body).toBe(item.body);
  expect(withCurrentArtifacts(toFeedPreview(item), versions).summary).toBeNull();
  expect(item.summary).not.toBeNull();
  expect(withCurrentArtifacts({ ...item, aiVersions: undefined }, versions).summary).toBeNull();
  expect(withCurrentArtifacts(item, null)).toBe(item);
  expect(withCurrentArtifacts({ ...item, demo: true }, versions).summary).toEqual(item.summary);
  expect(withCurrentArtifacts({ ...item, aiVersions: versions }, versions).translation).toBe(
    '旧译文',
  );
  expect(
    withCurrentArtifacts({ ...item, translation: null, translationBlocks: undefined }, versions)
      .translationBlocks,
  ).toBeUndefined();
});
