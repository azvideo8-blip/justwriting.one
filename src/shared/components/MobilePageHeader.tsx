import React from 'react';
import { cn } from '../../core/utils/utils';

interface MobilePageHeaderProps {
  title: string;
  right?: React.ReactNode;
  className?: string;
}

export function MobilePageHeader({ title, right, className }: MobilePageHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-center justify-between px-6 bg-surface-base border-b border-border-subtle shrink-0 w-full z-10",
        "h-[calc(44px+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)]",
        className
      )}
    >
      <h1 className="text-xl font-serif text-text-main font-bold truncate">
        {title}
      </h1>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </header>
  );
}
