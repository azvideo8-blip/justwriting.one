import { getIdToken } from '../auth';

// Пометка «списать с дневного лимита пользователя». Обычные фоновые эндпоинты
// платят из отдельного фонового лимита; обновление профиля — работа, которую
// человек заказал сам, и она обязана стоить ему видимых запросов, иначе она
// бесплатна и её можно жать бесконечно.
//
// Флаг можно только повысить себе цену, понизить нельзя — поэтому доверять его
// клиенту безопасно: сервер трактует отсутствие пометки как «фоновый лимит».
let chargeUserLimit = false;

/** Всё, что вызвано внутри, списывается с дневного лимита пользователя. */
export async function withUserCharge<T>(fn: () => Promise<T>): Promise<T> {
  const previous = chargeUserLimit;
  chargeUserLimit = true;
  try {
    return await fn();
  } finally {
    chargeUserLimit = previous;
  }
}

export async function callAi<T>(name: string, data: unknown): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new Error('AUTH_REQUIRED');

  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      data: chargeUserLimit && data && typeof data === 'object' ? { ...data, charge: 'user' } : data,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body?.error?.message ?? 'AI request failed'),
                        { code: body?.error?.code ?? 'internal' });
  }
  return body.result as T;
}
