export function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${m}:${String(secs).padStart(2, '0')}`;
}
