import { Timestamp } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { UserProfile, SessionPayload } from '../../../types';
import { WritingDraftService } from '../services/WritingDraftService';
import { WritingSessionService } from '../services/WritingSessionService';

export function buildSessionPayload(
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
  profile: UserProfile | null,
  user: User | null,
  userId: string
): SessionPayload {
  return {
    userId,
    authorName: profile?.nickname || user?.displayName || user?.email?.split('@')[0] || 'Guest',
    authorPhoto: user?.photoURL || '',
    nickname: profile?.nickname || '',
    title: state.title,
    content: state.content,
    pinnedThoughts: state.pinnedThoughts,
    duration: state.seconds,
    wordCount: state.wordCount,
    charCount: state.content.length,
    wpm: state.wpm,
    tags: state.tags,
    updatedAt: Timestamp.now(),
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
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }

  const sessionKey = `local_session_${Date.now()}_${crypto.randomUUID()}`;
  try {
    localStorage.setItem(sessionKey, JSON.stringify(sessionData));
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
