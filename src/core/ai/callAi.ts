import { getCurrentUser, getIdToken } from '../auth';
import { TimeoutError } from '../../shared/utils/withTimeout';
import { getAiConsent, isProfileLoaded } from './aiConsent';
import { hasIndexingConsent } from './indexingConsent';

// Эти действия не про обработку записей: удаление аккаунта — право субъекта,
// администрирование пользователей не требует согласия на анализ заметок.
const CONSENT_EXEMPT = new Set(['deleteAccount', 'inviteUser', 'listUsersWithStatus', 'adminDeleteUser']);

export interface CallAiOptions {
  charge?: 'user' | 'bulk';
  /**
   * SB-4: отмена по уходу со страницы. Пока сигнал был только у стрима, а
   * callable-повтор (AIService.chat) дописывался даже после закрытия чата.
   */
  signal?: AbortSignal;
}

/**
 * SB-4: клиентский потолок одного запроса к ИИ.
 *
 * Сервер сам себе дедлайн ставит (generate — 110 с, api/ai/provider.ts:118;
 * чат-стрим — 120 с, api/chat.ts:190), но до клиента это не доезжало: fetch жил
 * ровно столько, сколько ему позволено. `withTimeout` у AIService от вечности
 * спасает наполовину — он перестаёт ждать, а запрос остаётся в полёте со своим
 * слотом квоты. Здесь обрыв настоящий.
 *
 * 130 с заведомо больше обеих серверных цифр и самой длинной гонки AIService
 * (115 с), то есть легитимный ответ этот потолок не режет.
 */
export const AI_REQUEST_TIMEOUT_MS = 130_000;

export type QuotaHeadersListener = (headers: Headers) => void;
const quotaListeners = new Set<QuotaHeadersListener>();

export function onAiQuotaHeaders(listener: QuotaHeadersListener): () => void {
  quotaListeners.add(listener);
  return () => {
    quotaListeners.delete(listener);
  };
}

function notifyQuotaHeaders(headers?: Headers | null): void {
  if (!headers || typeof headers.has !== 'function') return;
  // SA-2: «unavailable» приходит без чисел — и именно тогда подписчик нужнее
  // всего: без него store продолжит показывать прошлое подтверждённое число.
  if (!headers.has('x-ai-quota-used') && headers.get('x-ai-quota-status') !== 'unavailable') return;
  quotaListeners.forEach(listener => {
    try {
      listener(headers);
    } catch {
      // ignore listener errors
    }
  });
}

export async function callAi<T>(
  name: string,
  data: unknown,
  opts: CallAiOptions = {},
): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new Error('AUTH_REQUIRED');

  if (!CONSENT_EXEMPT.has(name)) {
    const user = getCurrentUser();
    if (user && isProfileLoaded(user.uid)) {
      if (!getAiConsent(user.uid)) {
        throw Object.assign(new Error('AI_CONSENT_REQUIRED'), { code: 'AI_CONSENT_REQUIRED' });
      }
      if (name === 'embedDocument' && !hasIndexingConsent(user.uid)) {
        throw Object.assign(new Error('INDEXING_CONSENT_REQUIRED'), { code: 'INDEXING_CONSENT_REQUIRED' });
      }
    }
  }

  // Каждому вызову — своё окно: retryAfterTokenRefresh заходит сюда заново и не
  // наследует истёкший таймер предыдущей попытки.
  const controller = new AbortController();
  let abandon: (error: Error) => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => { abandon = reject; });
  const timer = setTimeout(() => {
    controller.abort();
    abandon(new TimeoutError('AI request timed out'));
  }, AI_REQUEST_TIMEOUT_MS);
  const onCallerAbort = () => {
    controller.abort();
    abandon(opts.signal?.reason instanceof Error
      ? opts.signal.reason
      : new DOMException('AI request aborted', 'AbortError'));
  };
  opts.signal?.addEventListener('abort', onCallerAbort, { once: true });

  let res: Response;
  try {
    res = await Promise.race([fetch(`/api/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        data: opts.charge === 'user' && data && typeof data === 'object' ? { ...data, charge: 'user' } : data,
      }),
      signal: controller.signal,
    }), deadline]);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onCallerAbort);
  }

  notifyQuotaHeaders(res.headers);

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // AUDIT-part3 2: переходная dual-form. Новая форма {error:{code,message}};
    // legacy {error:'CODE'} уважается, пока живы старые клиенты PWA.
    const legacyCode = typeof (body as { error?: unknown })?.error === 'string'
      ? (body as { error: string }).error
      : undefined;
    // Отказ без разбираемого тела приходит не от нашей логики, а с края:
    // nginx отдаёт 429 своей страницей, без JSON. Без этой подстановки такой
    // отказ доезжал до вызывающего как «internal», то есть ограничение частоты
    // выглядело поломкой сервиса — и повторять его никто не пробовал.
    const statusCode = res.status === 429 ? 'resource-exhausted' : 'internal';
    throw Object.assign(
      new Error(body?.error?.message ?? legacyCode ?? 'AI request failed'),
      { code: body?.error?.code ?? legacyCode ?? statusCode, status: res.status },
    );
  }
  return body.result as T;
}
