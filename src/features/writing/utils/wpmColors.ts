export function getWpmColor(wpm: number): string {
  if (wpm === 0) return 'bg-text-subtle';
  if (wpm < 15)  return 'bg-accent-danger';
  if (wpm < 35)  return 'bg-accent-warning';
  if (wpm < 50)  return 'bg-accent-success';
  return 'bg-accent-info';
}

export type WpmLevel = 'none' | 'slow' | 'steady' | 'fast';

// Пороги грубее цветовых полос: состояние скорости должно читаться и без цвета (DC-W6).
export function getWpmLevel(wpm: number): WpmLevel {
  if (wpm === 0) return 'none';
  if (wpm < 15) return 'slow';
  if (wpm < 50) return 'steady';
  return 'fast';
}

export function getWpmHex(wpm: number): string {
  if (wpm === 0) return 'var(--text-subtle)';
  if (wpm < 15)  return 'var(--accent-danger)';
  if (wpm < 35)  return 'var(--accent-warning)';
  if (wpm < 50)  return 'var(--accent-success)';
  return 'var(--accent-info)';
}
