import { getCurrentUser, getIdToken } from '../auth';
import { getAiConsent, isProfileLoaded } from './aiConsent';

// Эти два не про обработку записей: удаление аккаунта — право субъекта, и
// ставить его в зависимость от согласия было бы прямо противозаконно.
const CONSENT_EXEMPT = new Set(['deleteAccount', 'sendTelemetry']);

export interface CallAiOptions {
  charge?: 'user' | 'bulk';
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
    if (user && isProfileLoaded(user.uid) && !getAiConsent(user.uid)) {
      throw Object.assign(new Error('AI_CONSENT_REQUIRED'), { code: 'AI_CONSENT_REQUIRED' });
    }
  }

  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      data: opts.charge === 'user' && data && typeof data === 'object' ? { ...data, charge: 'user' } : data,
    }),
  });

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
