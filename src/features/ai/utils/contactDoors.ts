export interface DoorsResult {
  thinking: number;
  feeling: number;
  behavior: number;
  total: number;
  lowData: boolean;
}

const THINKING_MARKERS = [
  'думаю', 'мысл', 'кажется', 'считаю', 'понимаю', 'осознаю', 'анализ',
  'потому что', 'вывод', 'наверное', 'логично', 'размышля', 'идея', 'планирую',
  'понял', 'решил что', 'заключение', 'предполагаю', 'гипотез', 'наблюдени',
];

const FEELING_MARKERS = [
  'чувств', 'ощуща', 'злюсь', 'злость', 'боюсь', 'страх', 'тревог',
  'грустно', 'грусть', 'радост', 'обид', 'стыд', 'вина', 'раздраж',
  'тепло', 'спокойн', 'устал', 'нелегко', 'больно', 'тоскливо', 'вдохнов',
  'одинок', 'любов', 'нежн', 'благодар',
];

const BEHAVIOR_MARKERS = [
  'сделал', 'не сделал', 'пошёл', 'поехал', 'написал', 'начал', 'бросил',
  'купил', 'встал', 'лёг', 'позвонил', 'провёл', 'занимался', 'работал',
  'пришёл', 'ушёл', 'встретил', 'поговорил', 'помыл', 'приготовил',
  'выполнил', 'закончил', 'отложил', 'поехал', 'зашёл',
];

function countMatches(text: string, markers: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const marker of markers) {
    let idx = 0;
    while ((idx = lower.indexOf(marker, idx)) !== -1) {
      count++;
      idx += marker.length;
    }
  }
  return count;
}

export function analyzeDoors(text: string): DoorsResult {
  const t = countMatches(text, THINKING_MARKERS);
  const f = countMatches(text, FEELING_MARKERS);
  const b = countMatches(text, BEHAVIOR_MARKERS);
  const total = t + f + b;

  if (total === 0) {
    return { thinking: 0, feeling: 0, behavior: 0, total: 0, lowData: true };
  }

  return {
    thinking: t / total,
    feeling: f / total,
    behavior: b / total,
    total,
    lowData: total < 5,
  };
}

export interface AggregatedDoors {
  thinking: number;
  feeling: number;
  behavior: number;
  total: number;
  lowData: boolean;
  thinnestDoor: 'thinking' | 'feeling' | 'behavior' | null;
  dominantDoor: 'thinking' | 'feeling' | 'behavior' | null;
  byPeriod: { period: string; thinking: number; feeling: number; behavior: number; total: number }[];
}

export function aggregateDoors(
  perNote: { doors: DoorsResult; ts: number }[],
): AggregatedDoors {
  if (perNote.length === 0 || perNote.every(n => n.doors.lowData)) {
    return {
      thinking: 0, feeling: 0, behavior: 0, total: 0, lowData: true,
      thinnestDoor: null, dominantDoor: null, byPeriod: [],
    };
  }

  let totalT = 0, totalF = 0, totalB = 0, totalN = 0;
  for (const { doors } of perNote) {
    if (doors.lowData) continue;
    totalT += doors.thinking;
    totalF += doors.feeling;
    totalB += doors.behavior;
    totalN++;
  }

  if (totalN === 0) {
    return {
      thinking: 0, feeling: 0, behavior: 0, total: 0, lowData: true,
      thinnestDoor: null, dominantDoor: null, byPeriod: [],
    };
  }

  const sum = totalT + totalF + totalB || 1;
  const thinking = totalT / sum;
  const feeling = totalF / sum;
  const behavior = totalB / sum;

  const doors = { thinking, feeling, behavior };
  const entries = Object.entries(doors) as [keyof typeof doors, number][];
  const dominant = entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const thinnest = entries.reduce((a, b) => (b[1] < a[1] ? b : a))[0];

  const byMonth = new Map<string, { t: number; f: number; b: number; n: number }>();
  for (const { doors: d, ts } of perNote) {
    if (d.lowData) continue;
    const monthKey = new Date(ts).toISOString().slice(0, 7);
    const existing = byMonth.get(monthKey) ?? { t: 0, f: 0, b: 0, n: 0 };
    existing.t += d.thinking;
    existing.f += d.feeling;
    existing.b += d.behavior;
    existing.n++;
    byMonth.set(monthKey, existing);
  }

  const byPeriod = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, v]) => {
      const s = v.t + v.f + v.b || 1;
      return {
        period,
        thinking: v.t / s,
        feeling: v.f / s,
        behavior: v.b / s,
        total: v.n,
      };
    });

  return {
    thinking,
    feeling,
    behavior,
    total: totalN,
    lowData: false,
    thinnestDoor: thinnest,
    dominantDoor: dominant,
    byPeriod,
  };
}

const DOOR_LABELS: Record<'thinking' | 'feeling' | 'behavior', string> = {
  thinking: 'мысли',
  feeling: 'чувства',
  behavior: 'поведение',
};

export function doorLabel(door: 'thinking' | 'feeling' | 'behavior'): string {
  return DOOR_LABELS[door];
}
