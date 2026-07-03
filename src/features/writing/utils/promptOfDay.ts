const PROMPT_POOL = [
  'prompt_morning_1', 'prompt_morning_2', 'prompt_morning_3',
  'prompt_reflect_1', 'prompt_reflect_2', 'prompt_reflect_3',
  'prompt_creative_1', 'prompt_creative_2', 'prompt_creative_3',
];

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function getPromptOfDay(t: (key: string) => string): string {
  const dayOfYear = getDayOfYear(new Date());
  const key = PROMPT_POOL[dayOfYear % PROMPT_POOL.length]!;
  return t(key);
}
