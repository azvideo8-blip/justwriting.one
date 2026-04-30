import React, { useState, useRef } from 'react';
import { X } from 'lucide-react';

interface InlineTagsProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

export function InlineTags({ tags, onChange }: InlineTagsProps) {
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const removeTag = (e: React.MouseEvent, tag: string) => {
    e.stopPropagation();
    onChange(tags.filter(t => t !== tag));
  };

  const addTag = () => {
    const val = input.trim().replace(/^#+/, '');
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
    }
    setInput('');
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
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') addTag();
            if (e.key === 'Escape') { setAdding(false); setInput(''); }
          }}
          onBlur={addTag}
          autoFocus
          placeholder="тег"
          className="font-mono text-[10px] text-text-main border border-text-main/20 rounded px-1.5 py-0.5 bg-transparent outline-none w-16"
        />
      ) : (
        <button
          onClick={e => { e.stopPropagation(); setAdding(true); }}
          className="font-mono text-[10px] text-text-main/20 border border-dashed border-text-main/15 rounded px-1.5 py-0.5 hover:text-text-main/40 hover:border-text-main/25 transition-colors"
        >
          + тег
        </button>
      )}
    </div>
  );
}
