import { getLocalDb, type AIDocumentSummary } from '../../../core/storage/localDb';
import { getCurrentUser } from '../../../core/auth';
import { DataProvider } from '../../../core/data';
import { reportError } from '../../../shared/errors/reportError';
import { AIService } from './AIService';
import { AISummaryService } from './AISummaryService';
import { AIEmbeddingService } from './AIEmbeddingService';
import { indexDocument, sha256Hex } from '../utils/embeddingIndexer';

/**
 * Разбор одной заметки — по явному нажатию, и только по нему.
 *
 * Фоновый конвейер, который делал это сам по таймеру, убран: текст заметки
 * уходит стороннему поставщику ИИ, и решение об этом принимает человек, а не
 * приложение. Здесь собрана логика, которая до того была скопирована в четырёх
 * местах (фоновый проход, список архива, диагностика, восстановление) и в
 * каждом успела разойтись с остальными.
 */

export type AnalyzeResult =
  | { ok: true }
  | { ok: false; error: 'NO_CONTENT' | 'TOO_SHORT' | 'EXCLUDED' | AIErrorCode };

type AIErrorCode = 'AUTH_REQUIRED' | 'AI_CONSENT_REQUIRED' | 'DAILY_LIMIT' | 'RATE_LIMIT' | 'TOO_LONG' | 'SERVER_ERROR' | 'NETWORK' | 'MISCONFIGURED' | 'UPSTREAM';

/** Ниже этого заметка слишком коротка, чтобы из неё вышло что-то осмысленное. */
const MIN_CONTENT_CHARS = 50;
const MAX_CONTENT_CHARS = 50_000;

async function latestContent(documentId: string): Promise<string | null> {
  const db = await getLocalDb();
  const versions = await db.getAllFromIndex('versions', 'by-document', documentId);
  if (versions.length === 0) return null;
  versions.sort((a, b) => b.version - a.version);
  return versions[0]?.content ?? null;
}

export const NoteAnalysisService = {
  /** Сводка + вектор для одной заметки. Портрет, грани и дайджесты не трогает:
   *  они пересчитываются отдельно и по отдельному действию. */
  async analyze(documentId: string): Promise<AnalyzeResult> {
    const db = await getLocalDb();
    const doc = await db.get('documents', documentId);
    if (doc?.excludedFromAI) return { ok: false, error: 'EXCLUDED' };

    const content = await latestContent(documentId);
    if (!content || content.trim().length === 0) return { ok: false, error: 'NO_CONTENT' };
    if (content.length < MIN_CONTENT_CHARS) return { ok: false, error: 'TOO_SHORT' };

    // Три последние сводки дают модели минимальный контекст «что было рядом» —
    // без него echo и темы получаются оторванными от остальных заметок.
    const summaries = await db.getAll('aiSummaries');
    summaries.sort((a, b) => b.processedAt - a.processedAt);
    const recentContext = summaries.slice(0, 3).map(s => s.summary || s.tone).filter(Boolean).join('\n');

    const res = await AIService.summarize({
      content: content.slice(0, MAX_CONTENT_CHARS),
      ...(doc?.mood !== undefined ? { mood: doc.mood } : {}),
      ...(recentContext ? { recentContext } : {}),
      ...(doc?.lastSessionAt ? { noteDate: new Date(doc.lastSessionAt).toISOString().slice(0, 10) } : {}),
    });

    if (!res.ok) return { ok: false, error: res.error as AIErrorCode };

    const summary: AIDocumentSummary = {
      documentId,
      tone: res.summary.tone,
      frequentWords: res.summary.frequentWords,
      insights: res.summary.insights,
      themes: res.summary.themes,
      extractedFacts: res.summary.extractedFacts,
      processedAt: Date.now(),
      contentHash: await sha256Hex(content),
    };
    if (res.summary.summary !== undefined) summary.summary = res.summary.summary;
    if (res.summary.commitments !== undefined) summary.commitments = res.summary.commitments;
    if (res.summary.valence !== undefined) summary.valence = res.summary.valence;
    if (res.summary.arousal !== undefined) summary.arousal = res.summary.arousal;
    if (res.summary.echo !== undefined) summary.echo = res.summary.echo;
    if (res.summary.eventDate !== undefined) summary.eventDate = res.summary.eventDate;
    await AISummaryService.save(summary);

    if (doc) await db.put('documents', { ...doc, aiProcessed: true });

    // Темы заметки складываются в очередь реестра тем. Разбирает очередь
    // «Обновить профиль» — здесь её трогать нельзя: touchThemes не идемпотентен
    // (счётчик темы растёт на каждый вызов), да и лишние вызовы к поставщику
    // человек не заказывал.
    if ((summary.themes?.length ?? 0) > 0) {
      const { enqueuePendingThemeTouch } = await import('./AIThemeLedgerService');
      enqueuePendingThemeTouch(documentId);
    }

    // Вектор — вторым шагом и не критично: сводка уже сохранена, а без вектора
    // заметка просто не участвует в поиске по смыслу до следующего нажатия.
    try {
      await indexDocument(documentId, true);
    } catch (e) {
      reportError(e, { action: 'noteAnalysis_embed', documentId });
    }

    return { ok: true };
  },

  /** Удаляет всё, что разбор оставил после себя, — и на устройстве, и в облаке. */
  async clear(documentId: string): Promise<void> {
    await AISummaryService.delete(documentId);
    await AIEmbeddingService.delete(documentId);

    const db = await getLocalDb();
    const doc = await db.get('documents', documentId);
    if (doc?.aiProcessed) {
      const { aiProcessed: _dropped, ...rest } = doc;
      await db.put('documents', rest);
    }

    // Облачные копии: «удалить разбор» без этого оставляло бы сводку и вектор
    // лежать в базе, то есть ничего по сути не удаляло.
    const uid = getCurrentUser()?.uid;
    if (!uid || uid.startsWith('guest_')) return;
    try {
      await DataProvider.deleteSummary(uid, documentId);
      await DataProvider.deleteEmbedding(uid, documentId);
    } catch (e) {
      reportError(e, { action: 'noteAnalysis_clearCloud', documentId });
    }
  },
};
