import { getIdToken } from '../auth';

export async function callAi<T>(name: string, data: unknown): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new Error('AUTH_REQUIRED');

  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body?.error?.message ?? 'AI request failed'),
                        { code: body?.error?.code ?? 'internal' });
  }
  return body.result as T;
}
