import React, { useState, useRef } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';

interface InlineTagsProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  allTags?: string[];
}

export function InlineTags({ tags, onChange, allTags }: InlineTagsProps) {
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useLanguage();

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);

  const removeTag = (e: React.MouseEvent, tag: string) => {
    e.stopPropagation();
    onChange(tags.filter(t => t !== tag));
  };

  const selectSuggestion = (tag: string) => {
    onChange([...tags, tag]);
    setInput('');
    setSuggestions([]);
    setSelectedIdx(-1);
    inputRef.current?.focus();
  };

  const addTag = () => {
    const val = input.trim().replace(/^#+/, '');
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
    }
    setInput('');
    setSuggestions([]);
    setSelectedIdx(-1);
    setAdding(false);
  };

  return (
    <div className="flex flex-wrap gap-1.5 items-center" onClick={e => e.stopPropagation()}>
      {tags.map(tag => (
        <span
          key={tag}
          className="group/tag flex items-center gap-1 font-mono text-[10px] text-text-main/40 border border-border-subtle rounded px-1.5 py-0.5 hover:border-text-main/20 transition-colors"
        >
          #{tag}
          <button
            onClick={e => removeTag(e, tag)}
            className="text-text-main/20 hover:text-red-400 transition-colors opacity-0 group-hover/tag:opacity-100 -mr-0.5"
          >
            <X size={9} />
          </button>
        </span>
      ))}

      {adding ? (
        <div className="relative">
          <input
            ref={inputRef}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              setSelectedIdx(-1);
              if (allTags && e.target.value.trim()) {
                const q = e.target.value.trim().toLowerCase();
                setSuggestions(
                  allTags.filter(t => t.toLowerCase().includes(q) && !tags.includes(t)).slice(0, 7)
                );
              } else {
                setSuggestions([]);
              }
            }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIdx(i => Math.min(i + 1, suggestions.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIdx(i => Math.max(i - 1, -1));
              }
              if (e.key === 'Enter') {
                if (selectedIdx >= 0 && suggestions[selectedIdx]) {
                  selectSuggestion(suggestions[selectedIdx]);
                } else {
                  addTag();
                }
              }
              if (e.key === 'Escape') { setAdding(false); setInput(''); setSuggestions([]); }
            }}
            onBlur={() => { blurTimerRef.current = setTimeout(() => { setSuggestions([]); setSelectedIdx(-1); addTag(); }, 0); }}
            autoFocus
            placeholder={t('archive_tag_placeholder_short')}
            className="font-mono text-[10px] text-text-main border border-text-main/20 rounded px-1.5 py-0.5 bg-transparent outline-none w-16"
          />
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-0.5 z-50 bg-surface-card border border-border-subtle rounded-lg shadow-lg py-1 min-w-[120px]">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                   onMouseDown={e => { e.preventDefault(); if (blurTimerRef.current) clearTimeout(blurTimerRef.current); selectSuggestion(s); }}
                  className={cn(
                    "w-full text-left px-2.5 py-1 font-mono text-[11px] text-text-main/70 hover:bg-text-main/5 transition-colors",
                    i === selectedIdx && "bg-text-main/8 text-text-main"
                  )}
                >
                  #{s}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={e => { e.stopPropagation(); setAdding(true); }}
          className="font-mono text-[10px] text-text-main/40 border border-dashed border-text-main/25 rounded px-1.5 py-0.5 hover:text-brand-soft hover:border-brand-soft/40 transition-colors flex items-center gap-0.5"
        >
          <span className="text-[9px] leading-none">+</span>
          {t('archive_tag_add_short')}
        </button>
      )}
    </div>
  );
}
