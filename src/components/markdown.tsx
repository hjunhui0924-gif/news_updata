import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import type { Plugin } from 'unified';
export function Markdown({ text, tree }: { text: string; tree?: Root }) {
  const useTree: Plugin<[], Root> = () => () => tree;
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={tree ? [remarkGfm, useTree] : [remarkGfm]}
        skipHtml
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          img: () => null,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
