import { getLocalDb } from '../../../core/storage/localDb';
import type { AIDocumentSummary, AITimelineEntry } from '../../../core/storage/localDb';
import { getAuth } from 'firebase/auth';
import { getClient } from '../../../core/firebase/firestoreClient';
import { maybeEncrypt, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import {
  tryReserveSummarizeBudget,
  isGlobalWriteFailure,
  blockCloudWritesToday,
  areCloudWritesBlockedToday,
} from '../../../core/firebase/writeBudget';

const STRING_FIELDS = ['tone', 'echo', 'eventDate', 'quotableSentence'] as const;
const ARRAY_FIELDS = ['frequentWords', 'authorPhrases', 'insights', 'themes', 'extractedFacts', 'commitments'] as const;
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

/**
 * Decodes one cloud summary payload. Exported so the bulk restore decodes with
 * exactly this logic instead of growing a second parser that drifts from it.
 */
export async function decodeCloudSummary(
  data: Record<string, unknown>,
  documentId: string,
): Promise<AIDocumentSummary> {
  const decrypted = await maybeDecrypt(data, STRING_FIELDS_LIST, ARRAY_FIELDS_LIST);
  const docId = typeof decrypted.documentId === 'string' ? decrypted.documentId : documentId;
  const tone = typeof decrypted.tone === 'string' ? decrypted.tone : '';
  const echo = typeof decrypted.echo === 'string' ? decrypted.echo : '';
  const frequentWords = Array.isArray(decrypted.frequentWords) ? decrypted.frequentWords.map(String) : [];
  const authorPhrases = Array.isArray(decrypted.authorPhrases) ? decrypted.authorPhrases.map(String) : undefined;
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
  if (authorPhrases) result.authorPhrases = authorPhrases;
  if (typeof decrypted.quotableSentence === 'string') result.quotableSentence = decrypted.quotableSentence;
  if (typeof decrypted.promptVersion === 'number') result.promptVersion = decrypted.promptVersion;
  if (commitments.length > 0) result.commitments = commitments;
  if (valence !== undefined) result.valence = valence;
  if (arousal !== undefined) result.arousal = arousal;
  if (echo) result.echo = echo;
  if (typeof decrypted.eventDate === 'string') result.eventDate = decrypted.eventDate;
  const hash = decrypted.contentHash;
  if (typeof hash === 'string') result.contentHash = hash;
  // Круг замыкается здесь: сводка, восстановленная на другом устройстве, знает
  // каноничный id своей заметки и не подбирается по хешу текста.
  if (typeof decrypted.documentUuid === 'string') result.documentUuid = decrypted.documentUuid;
  return result;
}

async function fetchSummaryFromCloud(userId: string, documentId: string): Promise<AIDocumentSummary | undefined> {
  const { db, mod } = await getClient();
  const snap = await mod.getDoc(mod.doc(db, 'users', userId, 'summaries', documentId));
  if (!snap.exists()) return undefined;
  return decodeCloudSummary(snap.data() as Record<string, unknown>, documentId);
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
    // Populate documentUuid from the document for future reattach by uuid.
    const doc = await db.get('documents', summary.documentId);
    const withUuid = doc?.uuid ? { ...summary, documentUuid: doc.uuid } : summary;
    await db.put('aiSummaries', withUuid);
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
    if (uid && !areCloudWritesBlockedToday() && tryReserveSummarizeBudget()) {
      await saveSummaryToCloud(uid, withUuid).catch(e => {
        // Quota or rule rejection applies to every summary, not this one — stop
        // writing for the day rather than reporting it once per note.
        if (isGlobalWriteFailure(e)) blockCloudWritesToday();
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
