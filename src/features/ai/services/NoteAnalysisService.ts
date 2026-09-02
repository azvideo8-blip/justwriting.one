import { getLocalDb, type AIDocumentSummary } from '../../../core/storage/localDb';
import { getCurrentUser } from '../../../core/auth';
import { DataProvider } from '../../../core/data';
import { reportError } from '../../../shared/errors/reportError';
import { AIService } from './AIService';
import { AISummaryService } from './AISummaryService';
import { AIEmbeddingService } from './AIEmbeddingService';
import { indexDocument, indexPending, sha256Hex, type IndexResult } from '../utils/embeddingIndexer';
import { MAX_AI_CONTENT_LENGTH } from '../../../shared/ai/buildChatPrompt';
import type { AIErrorCode } from '../types/aiErrors';

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
  | { ok: true; indexed: IndexResult }
  | { ok: false; error: 'NO_CONTENT' | 'TOO_SHORT' | 'EXCLUDED' | AIErrorCode };

/** Почему проход по архиву остановился, не дойдя до конца очереди. */
export type BatchStop = 'daily' | 'rate' | 'global' | 'consent' | 'errors';

export interface BatchResult {
  analyzed: number;
  /** Отсеяны без обращения к поставщику: пусто, коротко, исключено из ИИ. */
  skipped: number;
  failed: number;
  /** Разобраны, но вектор посчитать не вышло — в поиске по смыслу их пока нет. */
  missingVectors: number;
  stopped: BatchStop | null;
}

/** Что из архива в разбор не пойдёт и почему — чтобы счётчик не врал. */
export interface PendingSurvey {
  ids: string[];
  /** Сколько заметок вообще лежит НА ЭТОМ устройстве. */
  totalDocuments: number;
  alreadyAnalyzed: number;
  excluded: number;
  tooShort: number;
  noContent: number;
}

/**
 * Шаг между заметками.
 *
 * Считать его от «двух вызовов на заметку» нельзя, и это выяснилось дорого:
 * `AISummaryService.save` разворачивается в `AICommitmentService`, а тот зовёт
 * `embed` ОТДЕЛЬНО НА КАЖДОЕ обязательство из заметки. На живом архиве вышло
 * около восьми обращений на заметку вместо двух — 112 запросов к `embed` на 14
 * сводок, — и проход снёс и наше минутное окно, и ограничитель nginx (60 в
 * минуту на адрес).
 *
 * Поэтому шаг здесь — только вежливость, а настоящая защита ниже: проход
 * пережидает отказ по частоте вместо того, чтобы предсказывать цену заметки.
 */
const NOTE_PACING_MS = 3_100;

/** Пауза после отказа по частоте: окно на сервере минутное. */
const RATE_BACKOFF_MS = 60_000;

/** Сколько раз подряд пережидаем, прежде чем признать, что дело не в частоте. */
const MAX_RATE_WAITS = 3;

/**
 * Подряд идущие отказы, после которых проход прекращается. Сеть, упавшая на
 * первой заметке, не должна перебрать все полторы сотни по очереди.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Ниже этого заметка слишком коротка, чтобы из неё вышло что-то осмысленное. */
const MIN_CONTENT_CHARS = 50;
const MAX_CONTENT_CHARS = MAX_AI_CONTENT_LENGTH;

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
    //
    // Исход возвращается наружу, а не теряется здесь: indexDocument сообщает об
    // упёршемся лимите возвратом ('daily'/'rate'), а не исключением. Проходу по
    // архиву это нужно знать — иначе он спокойно доберёт остаток дневного
    // бюджета на сводки, для которых векторов уже не будет, и отчитается
    // успехом за половину работы.
    let indexed: IndexResult = 'error';
    try {
      indexed = await indexDocument(documentId, true);
    } catch (e) {
      reportError(e, { action: 'noteAnalysis_embed', documentId });
    }

    return { ok: true, indexed };
  },

  /**
   * Заметки, которым разбор нужен: его нет вовсе либо текст изменился после
   * него. Отсев здесь тот же, что и в `analyze`, — чтобы счётчик перед запуском
   * называл настоящую цену, а не считал заодно исключённые и слишком короткие.
   */
  async findPending(): Promise<PendingSurvey> {
    const db = await getLocalDb();
    const documents = await db.getAll('documents');
    const summaries = await db.getAll('aiSummaries');
    const byDocument = new Map(summaries.map(s => [s.documentId, s]));

    const survey: PendingSurvey = {
      ids: [],
      totalDocuments: documents.length,
      alreadyAnalyzed: 0,
      excluded: 0,
      tooShort: 0,
      noContent: 0,
    };

    for (const doc of documents) {
      if (doc.excludedFromAI) {
        survey.excluded++;
        continue;
      }

      // Текста нет НА ЭТОМ устройстве: заметка может лежать в облаке целиком, а
      // сюда ещё не приехать. Разбирать нечего, но и молчать нельзя — иначе
      // очередь из полутора сотен заметок выглядит как очередь из тринадцати.
      const content = await latestContent(doc.id);
      if (!content || content.trim().length === 0) {
        survey.noContent++;
        continue;
      }
      if (content.length < MIN_CONTENT_CHARS) {
        survey.tooShort++;
        continue;
      }

      const existing = byDocument.get(doc.id);
      if (!existing) {
        survey.ids.push(doc.id);
        continue;
      }
      if (existing.contentHash !== await sha256Hex(content)) survey.ids.push(doc.id);
      else survey.alreadyAnalyzed++;
    }
    return survey;
  },

  /**
   * Разбор очереди заметок одним заказанным человеком проходом.
   *
   * Возобновляемый по построению: очередь считается от состояния хранилища, так
   * что следующий запуск начинается там, где предыдущий упёрся в лимит. Ничего
   * не помечает «пропущено навсегда» — заметка, до которой не дошли сегодня,
   * просто остаётся в очереди.
   */
  async analyzePending(opts?: {
    limit?: number;
    onProgress?: (p: { done: number; total: number; waiting?: boolean }) => void;
  }): Promise<BatchResult> {
    const survey = await NoteAnalysisService.findPending();
    const targets = opts?.limit != null ? survey.ids.slice(0, opts.limit) : survey.ids;

    const result: BatchResult = { analyzed: 0, skipped: 0, failed: 0, missingVectors: 0, stopped: null };
    let consecutiveFailures = 0;
    let rateWaits = 0;
    let i = 0;

    while (i < targets.length) {
      const res = await NoteAnalysisService.analyze(targets[i]!);

      // Отказ по частоте — не повод останавливать проход: цена заметки заранее
      // неизвестна (обязательства векторизуются по одному), так что попасть в
      // окно расчётом нельзя, а пережить его ожиданием — можно.
      if (!res.ok && res.error === 'RATE_LIMIT') {
        if (++rateWaits > MAX_RATE_WAITS) {
          result.stopped = 'rate';
          break;
        }
        opts?.onProgress?.({ done: i, total: targets.length, waiting: true });
        await sleep(RATE_BACKOFF_MS);
        continue;   // ту же заметку: за неё ничего не списано
      }

      i++;
      opts?.onProgress?.({ done: i, total: targets.length });

      if (res.ok) {
        result.analyzed++;
        consecutiveFailures = 0;

        if (res.indexed === 'daily') {
          result.missingVectors++;
          result.stopped = 'daily';
          break;
        }
        if (res.indexed === 'rate') {
          // Сводка уже сохранена и оплачена — повторять заметку нельзя, иначе
          // платим за неё дважды. Вектор доберём отдельным заходом в конце.
          result.missingVectors++;
          if (++rateWaits > MAX_RATE_WAITS) {
            result.stopped = 'rate';
            break;
          }
          opts?.onProgress?.({ done: i, total: targets.length, waiting: true });
          await sleep(RATE_BACKOFF_MS);
          continue;
        }
        if (res.indexed !== 'ok' && res.indexed !== 'skip') result.missingVectors++;
        rateWaits = 0;
      } else if (res.error === 'DAILY_LIMIT') {
        result.stopped = 'daily';
        break;
      } else if (res.error === 'GLOBAL_LIMIT') {
        result.stopped = 'global';
        break;
      } else if (res.error === 'AUTH_REQUIRED' || res.error === 'AI_CONSENT_REQUIRED') {
        result.stopped = 'consent';
        break;
      } else if (res.error === 'NO_CONTENT' || res.error === 'TOO_SHORT' || res.error === 'EXCLUDED') {
        // Ничего не потрачено: до поставщика такая заметка не доходит.
        result.skipped++;
      } else {
        result.failed++;
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          result.stopped = 'errors';
          break;
        }
      }

      if (i < targets.length) await sleep(NOTE_PACING_MS);
    }

    // Заметки, оставшиеся без вектора, добираются штатным проходом индексации:
    // он сам пропускает свежие и умеет останавливаться на лимите. Без этого
    // такая заметка осталась бы без вектора навсегда — очередь разбора смотрит
    // на сводки и второй раз её не предложит.
    if (result.missingVectors > 0 && result.stopped !== 'daily' && result.stopped !== 'consent') {
      try {
        const caught = await indexPending();
        result.missingVectors = Math.max(0, result.missingVectors - caught.ok);
      } catch (e) {
        reportError(e, { action: 'analyzePending_vectorCatchUp' });
      }
    }

    return result;
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
