export function getWpmColor(wpm: number): string {
  if (wpm === 0) return 'bg-text-subtle';
  if (wpm < 15)  return 'bg-accent-danger';
  if (wpm < 35)  return 'bg-accent-warning';
  if (wpm < 50)  return 'bg-accent-success';
  return 'bg-accent-info';
}

export function getWpmHex(wpm: number): string {
  if (wpm === 0) return 'var(--text-subtle)';
  if (wpm < 15)  return 'var(--accent-danger)';
  if (wpm < 35)  return 'var(--accent-warning)';
  if (wpm < 50)  return 'var(--accent-success)';
  return 'var(--accent-info)';
}
