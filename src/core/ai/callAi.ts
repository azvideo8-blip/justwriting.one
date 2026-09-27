import { getCurrentUser, getIdToken } from '../auth';
import { getAiConsent, isProfileLoaded } from './aiConsent';
import { hasIndexingConsent } from './indexingConsent';

// Эти действия не про обработку записей: удаление аккаунта — право субъекта,
// телеметрия и администрирование пользователей не требуют согласия на анализ заметок.
const CONSENT_EXEMPT = new Set(['deleteAccount', 'sendTelemetry', 'inviteUser', 'listUsersWithStatus']);

export interface CallAiOptions {
  charge?: 'user' | 'bulk';
}

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

  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      data: opts.charge === 'user' && data && typeof data === 'object' ? { ...data, charge: 'user' } : data,
    }),
  });

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
