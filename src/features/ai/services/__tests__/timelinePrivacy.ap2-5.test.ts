import { beforeEach, describe, expect, it } from 'vitest';
import { getLocalDb, type AITimelineEntry, type LocalDocument } from '../../../../core/storage/localDb';
import { AITimelineService } from '../AITimelineService';

const hidden = 'ap2-hidden';
const visible = 'ap2-visible';
const marker = 'AP2_TONE_PRIVATE';
const now = Date.now();
const doc = (id: string, extra: Partial<LocalDocument> = {}): LocalDocument => ({
  id, uuid: `uuid-${id}`, guestId: 'guest-ap2', title: id, currentVersion: 1,
  totalWords: 20, totalDuration: 1, sessionsCount: 1, firstSessionAt: now,
  lastSessionAt: now, tags: [], ...extra,
});
const entry = (documentId: string, month: string, tone: string, valence: number): AITimelineEntry => ({
  documentId, date: `${month}-15`, month, tone, valence, arousal: 0.4,
  facts: [`синтетический факт ${tone}`], themes: [], insights: [], eventDate: `${month}-15`,
});

beforeEach(async () => {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiTimeline'] as const) await db.clear(store);
  await db.put('documents', doc(visible));
  await db.put('documents', doc(hidden, { excludedFromAI: true }));
  await db.put('aiTimeline', entry(visible, '2026-08', 'спокойный', 0.5));
  await db.put('aiTimeline', entry(hidden, '2026-09', marker, -0.9));
});

describe('AP2-5: динамика настроения считает только видимые заметки', () => {
  it('getMoodTrend не берёт тон скрытой заметки', async () => {
    const trend = await AITimelineService.getMoodTrend(12);
    expect(JSON.stringify(trend)).toContain('спокойный');
    expect(JSON.stringify(trend)).not.toContain(marker);
    expect(trend.map(t => t.month)).not.toContain('2026-09');
  });

  it('getAffectTrend не берёт чувства скрытой заметки', async () => {
    const trend = await AITimelineService.getAffectTrend(30);
    expect(trend).toHaveLength(1);
    expect(trend[0]).toEqual({ date: '2026-08-15', valence: 0.5, arousal: 0.4 });
    expect(JSON.stringify(trend)).not.toContain(marker);
    expect(trend.some(e => e.valence < 0)).toBe(false);
  });
});
