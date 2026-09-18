import { describe, expect, it } from 'vitest';
import { resolveMarkdownUrl } from '@/shared/markdown';

describe('resolveMarkdownUrl', () => {
  const base = 'https://github.com/example/project/releases/tag/v1.0.0';

  it('resolves relative links and image sources against the source URL', () => {
    expect(resolveMarkdownUrl('../blob/main/docs/guide.md', base, 'href')).toBe(
      'https://github.com/example/project/releases/blob/main/docs/guide.md',
    );
    expect(resolveMarkdownUrl('./assets/diagram.png', base, 'src')).toBe(
      'https://github.com/example/project/releases/tag/assets/diagram.png',
    );
  });

  it('keeps fragments but rejects unsafe protocols and non-http images', () => {
    expect(resolveMarkdownUrl('#details', base, 'href')).toBe('#details');
    expect(resolveMarkdownUrl('javascript:alert(1)', base, 'href')).toBeNull();
    expect(resolveMarkdownUrl('data:image/png;base64,abc', base, 'src')).toBeNull();
    expect(resolveMarkdownUrl('mailto:maintainer@example.com', base, 'href')).toBe(
      'mailto:maintainer@example.com',
    );
  });
});
