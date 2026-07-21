import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

// SECURITY: rehype-sanitize strips all raw HTML from AI output.
// NEVER add rehype-raw to this component — it would re-enable XSS
// from unsanitized streaming AI responses (see api/chat.ts).
// Custom schema: strip img tags to prevent IP tracking via external image loads.
const SANITIZE_SCHEMA = {
  tagNames: ['p', 'strong', 'em', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'a', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del', 'sub', 'sup'],
  attributes: {
    a: ['href', 'title', 'target', 'rel'],
    th: ['align'],
    td: ['align'],
  },
  protocols: {
    href: ['http', 'https', 'mailto'],
  },
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
  onCitationClick?: (id: string) => void;
}

export const MarkdownRenderer = React.memo(
  function MarkdownRenderer({ content, className, onCitationClick }: MarkdownRendererProps) {
    return (
      <div className={className}>
        <ReactMarkdown
          rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA]]}
          remarkPlugins={[remarkGfm]}
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
            del: ({ children }) => <del className="line-through opacity-60">{children}</del>,
            table: ({ children }) => (
              <div className="overflow-x-auto my-2 border border-border-subtle/50 rounded-lg max-w-full">
                <table className="min-w-full divide-y divide-border-subtle/30 text-xs">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => <thead className="bg-text-main/[0.02]">{children}</thead>,
            tbody: ({ children }) => <tbody className="divide-y divide-border-subtle/20">{children}</tbody>,
            tr: ({ children }) => <tr>{children}</tr>,
            th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-text-main">{children}</th>,
            td: ({ children }) => <td className="px-3 py-1.5 text-text-main/80">{children}</td>,
            a: ({ href, children }) => {
              if (href && href.startsWith('#cite-')) {
                const id = href.replace('#cite-', '');
                const isUnknown = children != null && String(children).includes('?');
                return (
                  <button
                    type="button"
                    onClick={() => onCitationClick?.(id)}
                    disabled={isUnknown}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-brand-soft/20 text-brand-soft hover:bg-brand-soft/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-medium cursor-pointer align-baseline select-none"
                  >
                    {children}
                  </button>
                );
              }
              return <a href={href} className="text-brand-soft hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>;
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  },
  (prev, next) => prev.content === next.content && prev.className === next.className
);
