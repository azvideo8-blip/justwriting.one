interface LoadingSkeletonProps {
  lines?: number;
  className?: string;
  label?: string;
}

export function LoadingSkeleton({ lines = 3, className, label = 'Загружается...' }: LoadingSkeletonProps) {
  return (
    <div role="progressbar" aria-label={label} aria-busy="true" className={className}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 rounded bg-text-main/5 animate-pulse mb-2" />
      ))}
    </div>
  );
}
