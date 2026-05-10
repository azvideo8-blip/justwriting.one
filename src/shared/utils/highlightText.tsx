import React from 'react';

export function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  try {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return React.createElement(React.Fragment, null,
      ...parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? React.createElement('mark', { key: i, className: 'px-0.5 rounded bg-text-main/20 text-text-main' }, part)
          : part
      )
    );
  } catch {
    return text;
  }
}
