import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';

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
    // U-32: ссылка на заметку — маленькая плашка (~20 px); на телефоне цель
    // касания дорастает до 44 px настоящим padding'ом с ответным отрицательным
    // полем (B-3), раскладку не двигает и на соседнюю строку не залезает.
    const mobile = useLayoutMode().layoutMode === 'mobile';
    return (
      <div className={className}>
        <ReactMarkdown
          rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA]]}
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
            strong: ({ children }) => <strong className="font-semibold text-text-main">{children}</strong>,
            em: ({ children }) => <em className="italic">{children}</em>,
            ul: ({ children }) => <ul className="list-disc pl-4 mb-3 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal pl-4 mb-3 space-y-1">{children}</ol>,
            li: ({ children }) => <li className="text-sm">{children}</li>,
            h1: ({ children }) => <h1 className="text-base font-bold mt-4 mb-2">{children}</h1>,
            h2: ({ children }) => <h2 className="text-sm font-bold mt-4 mb-2">{children}</h2>,
            h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-2">{children}</h3>,
            blockquote: ({ children }) => <blockquote className="border-l-2 border-brand-soft/30 pl-3 my-3 text-text-main/60">{children}</blockquote>,
            code: ({ children }) => <code className="px-1 py-0.5 rounded bg-text-main/5 text-xs font-mono">{children}</code>,
            pre: ({ children }) => <pre className="p-2 rounded-lg bg-text-main/5 text-xs font-mono overflow-x-auto my-3">{children}</pre>,
            del: ({ children }) => <del className="line-through opacity-60">{children}</del>,
            table: ({ children }) => (
              <div className="overflow-x-auto my-3 border border-border-subtle/50 rounded-lg max-w-full">
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
                // Always clickable: whether the citation resolves is decided by
                // onCitationClick (it looks the document up and no-ops if missing).
                // Disabling on missing *display metadata* left dead icons for notes
                // that actually exist when the metadata fetch lagged or failed once.
                //
                // B-3 (0.10.2): раньше цель касания 44px рисовалась
                // absolutely-позиционированным псевдоэлементом поверх строки — он
                // залезал на «📅» ниже по тексту, и тап открывал превью чужой заметки.
                // Теперь, как у «×» вложения в 0.10.1: у кнопки настоящий padding, а
                // его прирост съедает ответный отрицательный margin — раскладка не
                // двигается, но зона становится настоящей и в потоке, а не оверлеем.
                // Видимая плашка (фон, скругление) живёт на внутреннем span, чтобы
                // вертикальный padding не растягивал саму плашку.
                return (
                  <button
                    type="button"
                    onClick={() => onCitationClick?.(id)}
                    // T-1 (приёмка 0.10.2): по вертикали запас 2 px — в межстрочье;
                    // py-3 давал 44 px коробку, и «📅» следующей строки (рисуется
                    // позже) перекрывал низ пилюли выше. Запас по ширине — 12 px.
                    // Встроенная в текст ссылка — исключение WCAG 2.5.8.
                    className={`inline-flex cursor-pointer items-center align-baseline select-none${mobile ? ' -my-0.5 -mx-3 px-3 py-0.5' : ' mx-0.5'}`}
                  >
                    <span className="inline-flex items-center gap-1 rounded bg-brand-soft/20 px-1.5 py-0.5 text-xs font-medium text-brand-soft transition-colors hover:bg-brand-soft/30">
                      {children}
                    </span>
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
