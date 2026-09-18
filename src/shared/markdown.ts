export type MarkdownUrlKind = 'href' | 'src';

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const IMAGE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Resolve Markdown URLs at the source document seam.
 *
 * Relative links only become actionable when the caller supplies the source
 * URL. Images are deliberately limited to HTTP(S) so Markdown cannot create
 * executable or data URLs in the reader.
 */
export function resolveMarkdownUrl(
  value: string,
  baseUrl: string | undefined,
  kind: MarkdownUrlKind,
): string | null {
  const input = value.trim();
  if (!input) return null;
  if (input.startsWith('#')) return input;

  let resolved: URL;
  try {
    resolved = new URL(input, baseUrl);
  } catch {
    return null;
  }

  const protocols = kind === 'src' ? IMAGE_PROTOCOLS : LINK_PROTOCOLS;
  return protocols.has(resolved.protocol.toLowerCase()) ? resolved.href : null;
}
