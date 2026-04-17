export function LoadingSkeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-xl bg-text-main/10 ${className ?? ''}`} />
  );
}

export function SessionCardSkeleton() {
  return (
    <div className="p-4 rounded-2xl border border-border-subtle bg-surface-card space-y-3">
      <LoadingSkeleton className="h-4 w-3/4" />
      <div className="flex gap-2">
        <LoadingSkeleton className="h-3 w-16" />
        <LoadingSkeleton className="h-3 w-12" />
      </div>
      <LoadingSkeleton className="h-3 w-full" />
      <LoadingSkeleton className="h-3 w-2/3" />
    </div>
  );
}

export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <LoadingSkeleton className="h-3 w-20" />
          <LoadingSkeleton className="h-3 flex-1" />
          <LoadingSkeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}
