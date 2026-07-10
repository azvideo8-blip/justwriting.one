import type { AITimelineEntry } from '../../../core/storage/localDb';

export interface Contradiction {
  theme: string;
  oldValence: number;
  newValence: number;
}

export function detectContradictions(timeline: AITimelineEntry[]): Contradiction[] {
  if (timeline.length < 2) return [];

  // Sort chronological ascending
  const sorted = [...timeline].sort((a, b) => a.date.localeCompare(b.date));

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  let recent = sorted.filter(e => e.date >= sevenDaysAgoStr);
  let baseline = sorted.filter(e => e.date < sevenDaysAgoStr);

  if ((recent.length === 0 || baseline.length === 0) && sorted.length >= 2) {
    const countRecent = Math.max(1, Math.min(sorted.length - 1, 3));
    recent = sorted.slice(-countRecent);
    baseline = sorted.slice(0, -countRecent);
  }

  // Get all unique themes in timeline
  const allThemes = new Set<string>();
  for (const e of timeline) {
    for (const t of e.themes ?? []) {
      if (t.trim()) allThemes.add(t.trim().toLowerCase());
    }
  }

  // Map lowercase to original casing
  const themeCaseMap = new Map<string, string>();
  for (const e of timeline) {
    for (const t of e.themes ?? []) {
      if (t.trim()) themeCaseMap.set(t.trim().toLowerCase(), t.trim());
    }
  }

  const contradictions: Contradiction[] = [];

  for (const t of allThemes) {
    // Recent entries containing theme t with valence
    const recentWithTheme = recent.filter(e =>
      typeof e.valence === 'number' &&
      e.themes?.map(x => x.toLowerCase()).includes(t)
    );

    // Baseline entries containing theme t with valence
    const baselineWithTheme = baseline.filter(e =>
      typeof e.valence === 'number' &&
      e.themes?.map(x => x.toLowerCase()).includes(t)
    );

    if (recentWithTheme.length > 0 && baselineWithTheme.length > 0) {
      const avgRecent = recentWithTheme.reduce((sum, e) => sum + e.valence!, 0) / recentWithTheme.length;
      const avgBaseline = baselineWithTheme.reduce((sum, e) => sum + e.valence!, 0) / baselineWithTheme.length;

      // Shift of > 0.5 in opposite directions
      if (
        (avgBaseline > 0.25 && avgRecent < -0.25) ||
        (avgBaseline < -0.25 && avgRecent > 0.25)
      ) {
        contradictions.push({
          theme: themeCaseMap.get(t) ?? t,
          oldValence: avgBaseline,
          newValence: avgRecent,
        });
      }
    }
  }

  return contradictions;
}

export function formatContradictions(contradictions: Contradiction[]): string {
  if (contradictions.length === 0) return '';

  return contradictions
    .map(c => {
      const oldState = c.oldValence > 0 ? 'позитивно' : 'негативно';
      const newState = c.newValence > 0 ? 'позитивно' : 'негативно';
      return `[Внутреннее противоречие]: Твое отношение к теме "${c.theme}" изменилось (раньше: ${oldState}, сейчас: ${newState}).`;
    })
    .join('\n');
}
