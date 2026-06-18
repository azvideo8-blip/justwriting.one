import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

// SECURITY: rehype-sanitize strips all raw HTML from AI output.
// NEVER add rehype-raw to this component — it would re-enable XSS
// from unsanitized streaming AI responses (see api/chat.ts).
interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        rehypePlugins={[rehypeSanitize]}
        components={{
          p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-text-main">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="text-sm">{children}</li>,
          h1: ({ children }) => <h1 className="text-base font-bold mt-2 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold mt-2 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-1 mb-0.5">{children}</h3>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-brand-soft/30 pl-3 my-1 text-text-main/60">{children}</blockquote>,
          code: ({ children }) => <code className="px-1 py-0.5 rounded bg-text-main/5 text-xs font-mono">{children}</code>,
          pre: ({ children }) => <pre className="p-2 rounded-lg bg-text-main/5 text-xs font-mono overflow-x-auto my-1">{children}</pre>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
