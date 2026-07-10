import type { AITimelineEntry } from '../../../core/storage/localDb';

export interface TrendAnalysis {
  emergingThemes: string[];
  fadingThemes: string[];
  moodSlope: 'improving' | 'flat' | 'declining';
  valenceDelta: number;
}

export function computeTrends(timeline: AITimelineEntry[]): TrendAnalysis {
  if (timeline.length === 0) {
    return { emergingThemes: [], fadingThemes: [], moodSlope: 'flat', valenceDelta: 0 };
  }

  // Sort timeline chronological ascending
  const sorted = [...timeline].sort((a, b) => a.date.localeCompare(b.date));

  // Determine recent vs baseline partition
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  let recent = sorted.filter(e => e.date >= sevenDaysAgoStr);
  let baseline = sorted.filter(e => e.date < sevenDaysAgoStr);

  // If recent is empty or baseline is empty, partition by index to ensure both are non-empty
  if ((recent.length === 0 || baseline.length === 0) && sorted.length >= 2) {
    const countRecent = Math.max(1, Math.min(sorted.length - 1, 3));
    recent = sorted.slice(-countRecent);
    baseline = sorted.slice(0, -countRecent);
  }

  // Extract themes
  const recentThemes = new Set<string>();
  for (const r of recent) {
    for (const t of r.themes ?? []) {
      if (t.trim()) recentThemes.add(t.trim().toLowerCase());
    }
  }

  const baselineThemes = new Set<string>();
  for (const b of baseline) {
    for (const t of b.themes ?? []) {
      if (t.trim()) baselineThemes.add(t.trim().toLowerCase());
    }
  }

  // Map lowercase to original case for presentation
  const themeCaseMap = new Map<string, string>();
  for (const e of timeline) {
    for (const t of e.themes ?? []) {
      if (t.trim()) themeCaseMap.set(t.trim().toLowerCase(), t.trim());
    }
  }

  const emerging: string[] = [];
  for (const t of recentThemes) {
    if (!baselineThemes.has(t)) {
      emerging.push(themeCaseMap.get(t) ?? t);
    }
  }

  const fading: string[] = [];
  for (const t of baselineThemes) {
    if (!recentThemes.has(t)) {
      fading.push(themeCaseMap.get(t) ?? t);
    }
  }

  // Calculate valence average
  const recentValences = recent.filter(e => typeof e.valence === 'number').map(e => e.valence!);
  const baselineValences = baseline.filter(e => typeof e.valence === 'number').map(e => e.valence!);

  let valenceDelta = 0;
  let moodSlope: 'improving' | 'flat' | 'declining' = 'flat';

  if (recentValences.length > 0 && baselineValences.length > 0) {
    const avgRecent = recentValences.reduce((sum, v) => sum + v, 0) / recentValences.length;
    const avgBaseline = baselineValences.reduce((sum, v) => sum + v, 0) / baselineValences.length;
    valenceDelta = avgRecent - avgBaseline;

    if (valenceDelta > 0.15) {
      moodSlope = 'improving';
    } else if (valenceDelta < -0.15) {
      moodSlope = 'declining';
    }
  }

  return {
    emergingThemes: emerging.slice(0, 5),
    fadingThemes: fading.slice(0, 5),
    moodSlope,
    valenceDelta,
  };
}

export function formatTrendsBlock(trends: TrendAnalysis): string {
  const lines = ['[Изменения за последнее время]'];

  if (trends.emergingThemes.length > 0) {
    lines.push(`- Новые темы: ${trends.emergingThemes.join(', ')}`);
  }
  if (trends.fadingThemes.length > 0) {
    lines.push(`- Ушедшие темы: ${trends.fadingThemes.join(', ')}`);
  }

  const slopeTranslation = {
    improving: 'улучшается 📈',
    declining: 'ухудшается 📉',
    flat: 'стабильно ➡️',
  };
  lines.push(`- Динамика настроения: ${slopeTranslation[trends.moodSlope]}`);

  return lines.join('\n');
}
