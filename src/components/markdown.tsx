import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
