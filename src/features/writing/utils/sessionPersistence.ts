import type { Timestamp } from 'firebase/firestore';
import { SessionPayload } from '../../../types';
import { getClient } from '../../../core/firebase/firestoreClient';
import { WritingDraftService } from '../services/WritingDraftService';
import { WritingSessionService } from '../services/WritingSessionService';

export async function buildSessionPayload(
  state: {
    title: string;
    content: string;
    pinnedThoughts: string[];
    seconds: number;
    wordCount: number;
    wpm: number;
    tags: string[];
    sessionType: string;
    sessionStartTime: number | null;
    timeGoalReached: boolean;
    wordGoalReached: boolean;
  },
  _profile: unknown,
  _user: unknown,
  userId: string
): Promise<SessionPayload> {
  const { mod } = await getClient();
  const { Timestamp: FirestoreTimestamp } = mod;
  return {
    userId,
    title: state.title,
    content: state.content,
    pinnedThoughts: state.pinnedThoughts,
    duration: state.seconds,
    wordCount: state.wordCount,
    charCount: state.content.length,
    wpm: state.wpm,
    tags: state.tags,
    updatedAt: FirestoreTimestamp.now() as Timestamp,
    sessionType: state.sessionType as SessionPayload['sessionType'],
    sessionStartTime: state.sessionStartTime,
    goalReached: state.sessionType === 'timer' ? state.timeGoalReached : (state.sessionType === 'words' ? state.wordGoalReached : true),
  };
}

export async function saveLocalOnly(sessionData: SessionPayload, userId: string): Promise<void> {
  try {
    const keysToRemove: string[] = [];
    const sessionKeys: { key: string; ts: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('local_session_')) {
        const ts = parseInt(key.split('_')[2] || '0', 10);
        sessionKeys.push({ key, ts });
      }
    }
    sessionKeys.sort((a, b) => a.ts - b.ts);
    while (sessionKeys.length >= 20) {
      const oldest = sessionKeys.shift();
      if (oldest) keysToRemove.push(oldest.key);
    }
    keysToRemove.forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
  } catch { /* ignore */ }

  const sessionKey = `local_session_${Date.now()}_${crypto.randomUUID()}`;
  try {
    const { authorName, authorPhoto, nickname, ...safePayload } = sessionData;
    localStorage.setItem(sessionKey, JSON.stringify(safePayload));
  } catch (e) {
    console.error('[saveLocalOnly] localStorage write failed:', e);
    return;
  }

  await WritingDraftService.deleteDraft(userId);
}

export async function saveToCloud(
  sessionData: SessionPayload,
  activeSessionId: string | null,
  isOnline: boolean,
  userId: string
): Promise<string | null> {
  const savedId = await WritingSessionService.saveSession(sessionData, activeSessionId, isOnline, userId);
  await WritingDraftService.deleteDraft(userId);
  return savedId;
}
