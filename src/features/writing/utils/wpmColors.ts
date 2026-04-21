export function getWpmColor(wpm: number): string {
  if (wpm === 0) return 'bg-text-subtle';
  if (wpm < 15)  return 'bg-accent-danger';
  if (wpm < 25)  return 'bg-accent-warning';
  if (wpm < 35)  return 'bg-accent-warning';
  if (wpm < 50)  return 'bg-accent-success';
  return 'bg-accent-info';
}

export function getWpmHex(wpm: number): string {
  if (wpm === 0) return 'rgba(255,255,255,0.15)';
  if (wpm < 15)  return '#ef4444';
  if (wpm < 25)  return '#f97316';
  if (wpm < 35)  return '#eab308';
  if (wpm < 50)  return '#22c55e';
  return '#60a5fa';
}
