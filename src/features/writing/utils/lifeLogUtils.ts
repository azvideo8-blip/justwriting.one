import { Session, Document } from '../../../types';
import { LocalDocument } from '../../../core/storage/localDb';
import { toDate } from '../../../core/utils/dateUtils';
import { getSessionDate } from '../../../core/utils/utils';
import { LifeLogDocument, SessionGroup } from '../types/lifeLog';

export function localDocToLifeLog(d: LocalDocument, hasCloud: boolean): LifeLogDocument {
  return {
    localId: d.id,
    cloudId: d.linkedCloudId || undefined,
    title: d.title,
    totalWords: d.totalWords,
    totalDuration: d.totalDuration,
    currentVersion: d.currentVersion,
    sessionsCount: d.sessionsCount,
    firstSessionAt: d.firstSessionAt,
    lastSessionAt: d.lastSessionAt,
    tags: d.tags,
    labelId: d.labelId ?? undefined,
    storage: { local: true, cloud: hasCloud },
    mood: d.mood,
  };
}

export function mergeUnifiedDocuments(
  localDocs: LocalDocument[],
  cloudDocs: Document[]
): LifeLogDocument[] {
  const cloudById = new Map(cloudDocs.map(d => [d.id, d]));
  const matchedCloudIds = new Set<string>();
  const unified: LifeLogDocument[] = [];

  for (const local of localDocs) {
    const cloud = local.linkedCloudId ? cloudById.get(local.linkedCloudId) : undefined;
    if (cloud) matchedCloudIds.add(cloud.id);
    unified.push(localDocToLifeLog(local, !!local.linkedCloudId));
  }

  for (const cloud of cloudDocs) {
    if (matchedCloudIds.has(cloud.id)) continue;
    unified.push({
      cloudId: cloud.id,
      title: cloud.title ?? '',
      totalWords: cloud.totalWords,
      totalDuration: cloud.totalDuration,
      currentVersion: cloud.currentVersion,
      sessionsCount: cloud.sessionsCount,
      firstSessionAt: toDate(cloud.firstSessionAt)?.getTime() ?? 0,
      lastSessionAt: toDate(cloud.lastSessionAt)?.getTime() ?? 0,
      tags: cloud.tags ?? [],
      labelId: cloud.labelId ?? undefined,
      storage: { local: false, cloud: true },
      mood: cloud.mood,
    });
  }

  unified.sort((a, b) => b.lastSessionAt - a.lastSessionAt);
  return unified;
}

export function groupSessionsByDate(
  unifiedDocuments: LifeLogDocument[],
  startOfToday: Date,
  t: (key: string) => string,
  language: string
): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  const yesterday = new Date(startOfToday);
  yesterday.setDate(yesterday.getDate() - 1);

  const docSessions = unifiedDocuments.map(d => ({
    id: d.localId || d.cloudId || '',
    userId: '',
    content: '',
    duration: d.totalDuration,
    wordCount: d.totalWords,
    charCount: 0,
    wpm: 0,
    title: d.title,
    tags: d.tags,
    createdAt: new Date(d.lastSessionAt),
    sessionStartTime: d.lastSessionAt ?? undefined,
    _isLocal: !!d.localId,
    mood: d.mood,
  } as Session));

  docSessions.forEach(entry => {
    const date = getSessionDate(entry);
    if (!date) return;

    const sessionDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const key = sessionDay.toISOString();

    if (!groups.has(key)) {
      let label: string;
      if (sessionDay.getTime() === startOfToday.getTime()) {
        label = t('lifelog_group_today');
      } else if (sessionDay.getTime() === yesterday.getTime()) {
        label = t('lifelog_group_yesterday');
      } else {
        label = date.toLocaleDateString(language, {
          day: 'numeric',
          month: 'long',
        });
      }
      groups.set(key, { label, date: sessionDay, sessions: [] });
    }

    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(entry);
    }
  });

  return Array.from(groups.values())
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function computeDailySummary(
  unifiedDocuments: LifeLogDocument[],
  startOfToday: Date
): { totalWords: number; totalMinutes: number } {
  let totalWords = 0;
  let totalDuration = 0;
  const startTs = startOfToday.getTime();

  for (const d of unifiedDocuments) {
    if (d.versions && d.versions.length > 0) {
      const todayVersions = d.versions.filter(v => v.savedAt >= startTs);
      for (const v of todayVersions) {
        totalWords += (v.wordsAdded ?? 0);
        totalDuration += (v.duration ?? 0);
      }
    } else if (d.lastSessionAt >= startTs) {
      totalWords += d.totalWords;
      totalDuration += d.totalDuration;
    }
  }

  return {
    totalWords,
    totalMinutes: Math.round(totalDuration / 60),
  };
}
