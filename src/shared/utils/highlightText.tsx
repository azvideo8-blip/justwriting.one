import React from 'react';

export function getSearchContext(content: string, query?: string, contextLen = 150): string {
  if (!content) return '';
  if (!query) return content.slice(0, 200);
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return content.slice(0, 200);
  const start = Math.max(0, idx - Math.floor(contextLen / 2));
  const end = Math.min(content.length, start + contextLen + query.length);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < content.length ? '...' : '';
  return prefix + content.slice(start, end) + suffix;
}

export function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  try {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="px-0.5 rounded bg-text-main/20 text-text-main">{part}</mark>
          : <React.Fragment key={i}>{part}</React.Fragment>
      )}
    </>;
  } catch {
    return text;
  }
}
