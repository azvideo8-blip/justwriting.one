export function LoadingSkeleton() {
  return (
    <style>{`
      @keyframes pulse-bg {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 0.35; }
      }
      .skeleton-pulse {
        animation: pulse-bg 1.5s ease-in-out infinite;
      }
    `}</style>
  );
}
