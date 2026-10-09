import { getCurrentUser } from '../../../core/auth';
import { getAiConsent } from '../../../core/ai/aiConsent';
import { getLocalDb } from '../../../core/storage/localDb';
import { MAX_AI_CONTENT_LENGTH } from '../../../shared/ai/buildChatPrompt';
import { sameWords } from '../../../shared/ai/sameWords';
import { isExcludedFromAI } from '../utils/isExcludedFromAI';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { AIService } from './AIService';

// D-3: пунктуация одного куска диктовки.
//
// Панель ИИ («Расставить знаки») отправляет на сервер всю заметку и просит
// человека проверить результат. Диктовке это не подходит: там текст только что
// сказали вслух, и он обязан оказаться в заметке. Поэтому правило одно: что бы
// ни случилось, возвращается исходный текст — диктовка не может провалиться
// из-за пунктуации.

export type DictationPunctuateReason =
  | 'empty'
  | 'offline'
  | 'limit'
  | 'not-signed-in'
  | 'no-consent'
  | 'note-hidden'
  | 'too-long'
  | 'words-changed'
  | 'error';

export interface DictationPunctuateResult {
  text: string;
  punctuated: boolean;
  reason?: DictationPunctuateReason;
}

/**
 * Синхронная прикидка «будет ли пунктуация» — для ИИ-метки на кнопке и строки
 * «будет потрачен 1 запрос» (D-4). Те же проверки, что в punctuateDictation,
 * кроме сети и длины текста. `noteHidden` передан подсказкой: флаг заметки
 * живёт в IndexedDB, а UI не может ждать асинхронный чтение ради иконки;
 * настоящая проверка всё равно в punctuateDictation, и скрытая заметка текст
 * наружу не отдаёт.
 */
export function willPunctuate(opts: { noteHidden?: boolean } = {}): { yes: boolean; remaining: number } {
  const remaining = useAiLimitStore.getState().remaining;
  const user = getCurrentUser();
  const consent = user ? getAiConsent(user.uid) : false;
  return {
    yes: Boolean(user) && consent && opts.noteHidden !== true && remaining > 0,
    remaining,
  };
}

/** Скрытая, выброшенная или непрочитанная заметка — true (fail-closed). Нужна и
 *  здесь, и панели записи (D-4) для ИИ-метки. */
export async function isDictationNoteHidden(documentId: string | undefined): Promise<boolean> {
  if (!documentId) return false; // новый, ещё не сохранённый текст: скрывать нечего
  try {
    const db = await getLocalDb();
    return isExcludedFromAI(await db.get('documents', documentId));
  } catch {
    return true;
  }
}

export async function punctuateDictation(
  raw: string,
  ctx: { documentId?: string | undefined },
): Promise<DictationPunctuateResult> {
  if (raw.trim().length === 0) return { text: '', punctuated: false, reason: 'empty' };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { text: raw, punctuated: false, reason: 'offline' };
  }

  const user = getCurrentUser();
  if (!user) return { text: raw, punctuated: false, reason: 'not-signed-in' };

  // Тот же гейт согласия, что у всех ИИ-функций (S-40): без него сервер ответил
  // бы AI_CONSENT_REQUIRED, и человек получил бы тост про ошибку сервиса вместо правды про согласие.
  if (!getAiConsent(user.uid)) return { text: raw, punctuated: false, reason: 'no-consent' };

  if (await isDictationNoteHidden(ctx.documentId)) {
    return { text: raw, punctuated: false, reason: 'note-hidden' };
  }

  // useRequest переименован: иначе rules-of-hooks принимает его за хук (так же делает AIPanel).
  const { remaining, useRequest: consumeRequest } = useAiLimitStore.getState();
  if (remaining <= 0) return { text: raw, punctuated: false, reason: 'limit' };

  if (raw.length > MAX_AI_CONTENT_LENGTH) return { text: raw, punctuated: false, reason: 'too-long' };

  try {
    const res = await AIService.process(raw, 'punctuate');
    if (!res.ok) return { text: raw, punctuated: false, reason: 'error' };
    if (!sameWords(raw, res.text)) {
      // Модель тронула слова (или ответ обрезан) — такой результат испортил бы
      // текст человека. Список запросов при этом не расходуется, как в панели.
      return { text: raw, punctuated: false, reason: 'words-changed' };
    }
    consumeRequest();
    return { text: res.text, punctuated: true };
  } catch {
    return { text: raw, punctuated: false, reason: 'error' };
  }
}
