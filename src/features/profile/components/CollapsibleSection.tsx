import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../core/utils/utils';

interface CollapsibleSectionProps {
  title: string;
  storageKey: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function CollapsibleSection({
  title,
  storageKey,
  children,
  defaultOpen = true,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved !== null ? saved === 'true' : defaultOpen;
  });

  const handleToggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    localStorage.setItem(storageKey, String(next));
  };

  return (
    <div className="bg-surface-card border border-border-subtle rounded-3xl overflow-hidden shadow-sm transition-all duration-300">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-surface-base/5 transition-colors border-b border-border-subtle/30"
      >
        <h2 className="text-base font-bold text-text-main font-sans tracking-wide">
          {title}
        </h2>
        <ChevronDown
          size={20}
          className={cn(
            'text-text-main/60 transition-transform duration-300',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div className="p-6 space-y-6">
          {children}
        </div>
      )}
    </div>
  );
}
