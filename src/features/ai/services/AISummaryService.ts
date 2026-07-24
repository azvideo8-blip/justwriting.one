import { getLocalDb } from '../../../core/storage/localDb';
import type { AIDocumentSummary, AITimelineEntry } from '../../../core/storage/localDb';
import { getAuth } from 'firebase/auth';
import { getClient } from '../../../core/firebase/firestoreClient';
import { maybeEncrypt, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import { tryReserveSummarizeBudget } from '../utils/firestoreWriteBudget';

const STRING_FIELDS = ['tone', 'echo', 'eventDate'] as const;
const ARRAY_FIELDS = ['frequentWords', 'insights', 'themes', 'extractedFacts', 'commitments'] as const;
const STRING_FIELDS_LIST: string[] = [...STRING_FIELDS];
const ARRAY_FIELDS_LIST: string[] = [...ARRAY_FIELDS];

async function saveSummaryToCloud(userId: string, summary: AIDocumentSummary): Promise<void> {
  const encrypted = await maybeEncrypt(
    { ...summary },
    STRING_FIELDS_LIST,
    ARRAY_FIELDS_LIST,
    userId,
  );
  const { db, mod } = await getClient();
  await mod.setDoc(mod.doc(db, 'users', userId, 'summaries', summary.documentId), encrypted, { merge: true });
}

async function fetchSummaryFromCloud(userId: string, documentId: string): Promise<AIDocumentSummary | undefined> {
  const { db, mod } = await getClient();
  const docRef = mod.doc(db, 'users', userId, 'summaries', documentId);
  const snap = await mod.getDoc(docRef);
  if (!snap.exists()) return undefined;
  const data = snap.data() as Record<string, unknown>;
  const decrypted = await maybeDecrypt(data, STRING_FIELDS_LIST, ARRAY_FIELDS_LIST);
  const docId = typeof decrypted.documentId === 'string' ? decrypted.documentId : documentId;
  const tone = typeof decrypted.tone === 'string' ? decrypted.tone : '';
  const echo = typeof decrypted.echo === 'string' ? decrypted.echo : '';
  const frequentWords = Array.isArray(decrypted.frequentWords) ? decrypted.frequentWords.map(String) : [];
  const insights = Array.isArray(decrypted.insights) ? decrypted.insights.map(String) : [];
  const themes = Array.isArray(decrypted.themes) ? decrypted.themes.map(String) : [];
  const extractedFacts = Array.isArray(decrypted.extractedFacts) ? decrypted.extractedFacts.map(String) : [];
  const commitments = Array.isArray(decrypted.commitments) ? decrypted.commitments.map(String) : [];
  const mentionedPeople = Array.isArray(decrypted.mentionedPeople)
    ? decrypted.mentionedPeople.filter((p: unknown) => typeof p === 'object' && p !== null && 'name' in (p as Record<string, unknown>)) as { name: string; role: string }[]
    : [];
  const processedAt = typeof decrypted.processedAt === 'number' ? decrypted.processedAt : Date.now();
  const valence = typeof decrypted.valence === 'number' ? decrypted.valence : undefined;
  const arousal = typeof decrypted.arousal === 'number' ? decrypted.arousal : undefined;

  const result: AIDocumentSummary = {
    documentId: docId,
    tone,
    frequentWords,
    insights,
    themes,
    extractedFacts,
    mentionedPeople,
    processedAt,
  };
  if (commitments.length > 0) result.commitments = commitments;
  if (valence !== undefined) result.valence = valence;
  if (arousal !== undefined) result.arousal = arousal;
  if (echo) result.echo = echo;
  if (typeof decrypted.eventDate === 'string') result.eventDate = decrypted.eventDate;
  const hash = decrypted.contentHash;
  if (typeof hash === 'string') result.contentHash = hash;
  return result;
}

export const AISummaryService = {
  async get(documentId: string): Promise<AIDocumentSummary | undefined> {
    const db = await getLocalDb();
    const local = await db.get('aiSummaries', documentId);
    if (local) return local;

    const uid = getAuth().currentUser?.uid;
    if (uid) {
      try {
        const cloud = await fetchSummaryFromCloud(uid, documentId);
        if (cloud) {
          await db.put('aiSummaries', cloud);
          return cloud;
        }
      } catch (e) {
        reportError(e, { action: 'ai_summary_cloud_fetch', documentId });
      }
    }
    return undefined;
  },

  async save(summary: AIDocumentSummary): Promise<void> {
    const db = await getLocalDb();
    await db.put('aiSummaries', summary);

    // Look up doc to get lastSessionAt
    const doc = await db.get('documents', summary.documentId);
    if (doc?.lastSessionAt) {
      const d = new Date(doc.lastSessionAt);
      if (!isNaN(d.getTime())) {
        const dateStr = d.toISOString().slice(0, 10);
        const monthStr = d.toISOString().slice(0, 7);

        // Save to Timeline
        const timelineEntry: AITimelineEntry = {
          documentId: summary.documentId,
          date: dateStr,
          month: monthStr,
          facts: summary.extractedFacts ?? [],
          tone: summary.tone,
          themes: summary.themes ?? [],
          insights: summary.insights ?? [],
          eventDate: summary.eventDate ?? dateStr,
        };
        if (summary.summary !== undefined) {
          timelineEntry.summary = summary.summary;
        }
        if (summary.valence !== undefined) {
          timelineEntry.valence = summary.valence;
        }
        if (summary.arousal !== undefined) {
          timelineEntry.arousal = summary.arousal;
        }
        await db.put('aiTimeline', timelineEntry);

        // Enqueue theme touch for background processing (AG-MIND-W1a-fix)
        if ((summary.themes?.length ?? 0) > 0) {
          try {
            const { enqueuePendingThemeTouch } = await import('./AIThemeLedgerService');
            enqueuePendingThemeTouch(summary.documentId);
          } catch (e) {
            console.warn('[AISummaryService] Failed to enqueue Theme Ledger touch:', e);
          }
        }


        // Upsert commitments

        if (summary.commitments && summary.commitments.length > 0) {
          try {
            const { AICommitmentService } = await import('./AICommitmentService');
            await AICommitmentService.upsertCommitments(summary.documentId, summary.commitments, dateStr);
          } catch (e) {
            console.warn('[AISummaryService] Failed to upsert commitments:', e);
          }
        }

        // Trigger monthly digest generation fire-and-forget
        try {
          const { AIMonthlyDigestService } = await import('./AIMonthlyDigestService');
          const existingDigest = await AIMonthlyDigestService.get(monthStr);
          const oneDayMs = 24 * 60 * 60 * 1000;
          if (!existingDigest || (Date.now() - existingDigest.generatedAt > oneDayMs)) {
            void AIMonthlyDigestService.generateForMonth(monthStr);
          }
        } catch (e) {
          console.warn('[AISummaryService] Failed to generate monthly digest:', e);
        }
      }
    }

    // Upsert people index
    if (summary.mentionedPeople && summary.mentionedPeople.length > 0) {
      for (const p of summary.mentionedPeople) {
        if (!p.name?.trim()) continue;
        const key = p.name.trim().toLowerCase();
        const existingPerson = await db.get('aiPeopleIndex', key);
        const noteIds = existingPerson ? [...existingPerson.noteIds] : [];
        if (!noteIds.includes(summary.documentId)) {
          noteIds.push(summary.documentId);
        }
        const lastMentionedAt = doc?.lastSessionAt ?? Date.now();
        const role = p.role?.trim() || existingPerson?.role || '';
        
        const name = p.name.trim();
        const displayName = name.charAt(0).toUpperCase() + name.slice(1);

        await db.put('aiPeopleIndex', {
          key,
          name: displayName,
          role,
          noteIds,
          lastMentionedAt,
          mentionCount: noteIds.length,
          // Preserve a prior consent decision — re-summarizing a note must not
          // reset an "ignored"/"active" person back to undefined.
          ...(existingPerson?.status !== undefined ? { status: existingPerson.status } : {}),
        });
      }
    }

    const uid = getAuth().currentUser?.uid;
    if (uid && tryReserveSummarizeBudget()) {
      await saveSummaryToCloud(uid, summary).catch(e => {
        reportError(e, { action: 'ai_summary_cloud_save' });
      });
    }
  },

  async delete(documentId: string): Promise<void> {
    const db = await getLocalDb();
    await db.delete('aiSummaries', documentId);
    await db.delete('aiTimeline', documentId);

    // Remove from people index
    const people = await db.getAll('aiPeopleIndex');
    for (const p of people) {
      if (p.noteIds.includes(documentId)) {
        const updatedNoteIds = p.noteIds.filter(id => id !== documentId);
        if (updatedNoteIds.length === 0) {
          await db.delete('aiPeopleIndex', p.key);
        } else {
          p.noteIds = updatedNoteIds;
          p.mentionCount = updatedNoteIds.length;
          await db.put('aiPeopleIndex', p);
        }
      }
    }
  },

  async exportAsMarkdown(documentId: string, docTitle: string): Promise<string> {
    const db = await getLocalDb();
    const summary = await db.get('aiSummaries', documentId);
    if (!summary) return '';

    const dateStr = new Date(summary.processedAt).toLocaleString();
    const lines = [
      `# Анализ документа: ${docTitle}`,
      `Дата анализа: ${dateStr}`,
      '',
      `**Тональность:** ${summary.tone}`,
      `**Ключевые слова:** ${summary.frequentWords.join(', ')}`,
      `**Темы:** ${summary.themes.join(', ')}`,
      '',
      '## Инсайты',
      ...summary.insights.map(i => `- ${i}`),
    ];

    const facts = summary.extractedFacts ?? [];
    if (facts.length > 0) {
      lines.push('', '## Факты', ...facts.map(f => `- ${f}`));
    }

    return lines.join('\n');
  },

  async hasAll(): Promise<Record<string, boolean>> {
    const db = await getLocalDb();
    const all = await db.getAll('aiSummaries');
    const map: Record<string, boolean> = {};
    for (const s of all) {
      map[s.documentId] = true;
    }
    return map;
  },
};
