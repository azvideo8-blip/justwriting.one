import { describe, it, expect } from 'vitest';
import {
  localDocToLifeLog,
  mergeUnifiedDocuments,
  groupSessionsByDate,
  computeDailySummary,
} from '../lifeLogUtils';
import { LifeLogDocument } from '../../types/lifeLog';
import { LocalDocument } from '../../../../core/storage/localDb';
import { Document } from '../../../../types';
// Timestamp import removed — we now use Date instead of Timestamp

function makeLocalDoc(overrides: Partial<LocalDocument> = {}): LocalDocument {
  return {
    id: 'local1',
    guestId: 'user1',
    title: 'Test Doc',
    totalWords: 100,
    totalDuration: 600,
    currentVersion: 1,
    sessionsCount: 1,
    firstSessionAt: Date.now() - 3600000,
    lastSessionAt: Date.now(),
    tags: [],
    labelId: undefined,
    linkedCloudId: undefined,
    ...overrides,
  };
}

function makeCloudDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'cloud1',
    userId: 'user1',
    title: 'Cloud Doc',
    totalWords: 200,
    totalDuration: 1200,
    currentVersion: 2,
    sessionsCount: 2,
    firstSessionAt: new Date(Date.now() - 7200000),
    lastSessionAt: new Date(Date.now() - 3600000),
    tags: [],
    labelId: undefined,
    ...overrides,
  };
}

describe('localDocToLifeLog', () => {
  it('hasCloud=true → storage.cloud=true', () => {
    const result = localDocToLifeLog(makeLocalDoc(), true);
    expect(result.storage).toEqual({ local: true, cloud: true });
  });

  it('hasCloud=false → storage.cloud=false', () => {
    const result = localDocToLifeLog(makeLocalDoc(), false);
    expect(result.storage).toEqual({ local: true, cloud: false });
  });

  it('labelId undefined → labelId undefined', () => {
    const result = localDocToLifeLog(makeLocalDoc({ labelId: undefined }), false);
    expect(result.labelId).toBeUndefined();
  });

  it('linkedCloudId present → cloudId set', () => {
    const result = localDocToLifeLog(makeLocalDoc({ linkedCloudId: 'cloud1' }), true);
    expect(result.cloudId).toBe('cloud1');
  });

  it('linkedCloudId undefined → cloudId undefined', () => {
    const result = localDocToLifeLog(makeLocalDoc({ linkedCloudId: undefined }), false);
    expect(result.cloudId).toBeUndefined();
  });
});

describe('mergeUnifiedDocuments', () => {
  it('local-only doc → storage: { local: true, cloud: false }', () => {
    const result = mergeUnifiedDocuments([makeLocalDoc()], []);
    expect(result).toHaveLength(1);
    expect(result[0].storage).toEqual({ local: true, cloud: false });
  });

  it('local doc linked to cloud → storage: { local: true, cloud: true }', () => {
    const result = mergeUnifiedDocuments(
      [makeLocalDoc({ linkedCloudId: 'cloud1' })],
      [makeCloudDoc({ id: 'cloud1' })]
    );
    expect(result).toHaveLength(1);
    expect(result[0].storage).toEqual({ local: true, cloud: true });
  });

  it('cloud-only doc (no local match) → storage: { local: false, cloud: true }', () => {
    const result = mergeUnifiedDocuments([], [makeCloudDoc()]);
    expect(result).toHaveLength(1);
    expect(result[0].storage).toEqual({ local: false, cloud: true });
  });

  it('same doc in local and cloud (via linkedCloudId) → one entry, not two', () => {
    const result = mergeUnifiedDocuments(
      [makeLocalDoc({ linkedCloudId: 'cloud1' })],
      [makeCloudDoc({ id: 'cloud1' })]
    );
    expect(result).toHaveLength(1);
  });

  it('result sorted by lastSessionAt desc', () => {
    const early = makeLocalDoc({ id: 'early', lastSessionAt: 1000 });
    const late = makeLocalDoc({ id: 'late', lastSessionAt: 2000 });
    const result = mergeUnifiedDocuments([early, late], []);
    expect(result[0].localId).toBe('late');
    expect(result[1].localId).toBe('early');
  });

  it('empty localDocs + empty cloudDocs → []', () => {
    expect(mergeUnifiedDocuments([], [])).toEqual([]);
  });

  it('empty localDocs + cloudDocs → only cloud entries', () => {
    const result = mergeUnifiedDocuments([], [makeCloudDoc()]);
    expect(result).toHaveLength(1);
    expect(result[0].cloudId).toBe('cloud1');
  });
});

describe('groupSessionsByDate', () => {
  const t = (key: string) => key;
  const language = 'en';

  function makeLifeLogDoc(overrides: Partial<LifeLogDocument> = {}): LifeLogDocument {
    const now = Date.now();
    return {
      localId: 's1',
      title: 'Doc',
      totalWords: 100,
      totalDuration: 60,
      currentVersion: 1,
      sessionsCount: 1,
      firstSessionAt: now,
      lastSessionAt: now,
      tags: [],
      storage: { local: true, cloud: false },
      ...overrides,
    };
  }

  it('session today → group label = t("lifelog_group_today")', () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const doc = makeLifeLogDoc({ lastSessionAt: now.getTime() });
    const groups = groupSessionsByDate([doc], startOfToday, t, language);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('lifelog_group_today');
  });

  it('session yesterday → group label = t("lifelog_group_yesterday")', () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(startOfToday.getTime() - 86400000);
    const doc = makeLifeLogDoc({ lastSessionAt: yesterday.getTime() });
    const groups = groupSessionsByDate([doc], startOfToday, t, language);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('lifelog_group_yesterday');
  });

  it('multiple sessions same day → one group, multiple entries', () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d1 = makeLifeLogDoc({ localId: 's1', lastSessionAt: now.getTime() });
    const d2 = makeLifeLogDoc({ localId: 's2', lastSessionAt: now.getTime() });
    const groups = groupSessionsByDate([d1, d2], startOfToday, t, language);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(2);
  });

  it('deduplicates: single doc not duplicated', () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const doc = makeLifeLogDoc({ localId: 's1', lastSessionAt: now.getTime() });
    const groups = groupSessionsByDate([doc], startOfToday, t, language);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(1);
  });

  it('groups sorted desc by date', () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(startOfToday.getTime() - 86400000);
    const d1 = makeLifeLogDoc({ localId: 's1', lastSessionAt: now.getTime() });
    const d2 = makeLifeLogDoc({ localId: 's2', lastSessionAt: yesterday.getTime() });
    const groups = groupSessionsByDate([d1, d2], startOfToday, t, language);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('lifelog_group_today');
    expect(groups[1].label).toBe('lifelog_group_yesterday');
  });

  it('empty inputs → []', () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    expect(groupSessionsByDate([], startOfToday, t, language)).toEqual([]);
  });
});

describe('computeDailySummary', () => {
  it('only today docs count toward totalWords and totalMinutes', () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const docs: LifeLogDocument[] = [
      { title: 'Today', totalWords: 200, totalDuration: 120, currentVersion: 1, sessionsCount: 1, firstSessionAt: now.getTime(), lastSessionAt: now.getTime(), tags: [], storage: { local: true, cloud: false } },
    ];
    const result = computeDailySummary(docs, startOfToday);
    expect(result.totalWords).toBe(200);
    expect(result.totalMinutes).toBe(2);
  });

  it('yesterday doc is excluded', () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayTs = startOfToday.getTime() - 86400000;
    const docs: LifeLogDocument[] = [
      { title: 'Yesterday', totalWords: 500, totalDuration: 3600, currentVersion: 1, sessionsCount: 1, firstSessionAt: yesterdayTs, lastSessionAt: yesterdayTs, tags: [], storage: { local: true, cloud: false } },
    ];
    const result = computeDailySummary(docs, startOfToday);
    expect(result.totalWords).toBe(0);
    expect(result.totalMinutes).toBe(0);
  });

  it('totalMinutes = round(totalDuration / 60)', () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const docs: LifeLogDocument[] = [
      { title: 'Doc', totalWords: 0, totalDuration: 90, currentVersion: 1, sessionsCount: 1, firstSessionAt: now.getTime(), lastSessionAt: now.getTime(), tags: [], storage: { local: true, cloud: false } },
    ];
    const result = computeDailySummary(docs, startOfToday);
    expect(result.totalMinutes).toBe(2);
  });

  it('empty docs → { totalWords: 0, totalMinutes: 0 }', () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const result = computeDailySummary([], startOfToday);
    expect(result).toEqual({ totalWords: 0, totalMinutes: 0 });
  });
});
