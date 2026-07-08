import { getLocalDb } from '../../../core/storage/localDb';
import type { AIDocumentSummary } from '../../../core/storage/localDb';
import { getAuth } from 'firebase/auth';
import { getClient } from '../../../core/firebase/firestoreClient';
import { maybeEncrypt, maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import { tryReserveSummarizeBudget } from '../utils/firestoreWriteBudget';

const STRING_FIELDS = ['tone'] as const;
const ARRAY_FIELDS = ['frequentWords', 'insights', 'themes', 'extractedFacts'] as const;
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
  const snap = await mod.getDoc(mod.doc(db, 'users', userId, 'summaries', documentId));
  if (!snap.exists()) return undefined;
  const data = snap.data() as Record<string, unknown>;
  const decrypted = await maybeDecrypt(data, STRING_FIELDS_LIST, ARRAY_FIELDS_LIST);
  const docId = typeof decrypted.documentId === 'string' ? decrypted.documentId : documentId;
  const tone = typeof decrypted.tone === 'string' ? decrypted.tone : '';
  const frequentWords = Array.isArray(decrypted.frequentWords) ? decrypted.frequentWords.map(String) : [];
  const insights = Array.isArray(decrypted.insights) ? decrypted.insights.map(String) : [];
  const themes = Array.isArray(decrypted.themes) ? decrypted.themes.map(String) : [];
    const extractedFacts = Array.isArray(decrypted.extractedFacts) ? decrypted.extractedFacts.map(String) : [];
    const mentionedPeople = Array.isArray(decrypted.mentionedPeople)
      ? decrypted.mentionedPeople.filter((p: unknown) => typeof p === 'object' && p !== null && 'name' in (p as Record<string, unknown>)) as { name: string; role: string }[]
      : [];
    const processedAt = typeof decrypted.processedAt === 'number' ? decrypted.processedAt : Date.now();
    return {
      documentId: docId,
      tone,
      frequentWords,
      insights,
      themes,
      extractedFacts,
      mentionedPeople,
      processedAt,
    };
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
        if (!String(e).includes('LOCKED')) {
          reportError(e, { action: 'ai_summary_cloud_read' });
        }
      }
    }
    return undefined;
  },

  async save(summary: AIDocumentSummary): Promise<void> {
    const db = await getLocalDb();
    await db.put('aiSummaries', summary);

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
