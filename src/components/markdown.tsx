'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import type { Plugin } from 'unified';
import { resolveMarkdownUrl } from '@/shared/markdown';

function MarkdownImage({
  src,
  alt,
  title,
}: {
  src?: string | Blob;
  alt?: string;
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="markdown-image-fallback" role="img" aria-label={alt || '图片不可用'}>
        <span aria-hidden="true">图片</span>
        {alt || '图片暂时无法加载'}
      </span>
    );
  }
  return (
    // Markdown sources are user-selected external URLs; Next Image would require
    // an open-ended remotePatterns list and would proxy content unnecessarily.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="markdown-image"
      src={src}
      alt={alt ?? ''}
      title={title}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function Markdown({
  text,
  tree,
  baseUrl,
}: {
  text: string;
  tree?: Root;
  baseUrl?: string;
}) {
  const useTree: Plugin<[], Root> = () => () => tree;
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={tree ? [remarkGfm, useTree] : [remarkGfm]}
        skipHtml
        urlTransform={(url, key) =>
          resolveMarkdownUrl(url, baseUrl, key === 'src' ? 'src' : 'href')
        }
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          img: (props) => <MarkdownImage {...props} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
