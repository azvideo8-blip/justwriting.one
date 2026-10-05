// V-1.3: мастер приглашения и форма сброса пароля объясняют отказ одним и тем
// же способом. Два экземпляра маппинга разъехались бы в ту же ловушку, из
// которой мастер уже вышел: «нет сети» вместо потерянного входа по ссылке.
export type PasswordErrorKind = 'offline' | 'session_lost' | 'failed';

export function passwordErrorKind(err: unknown): PasswordErrorKind {
  const name = (err as { name?: unknown } | null)?.name;
  const message = err instanceof Error ? err.message : '';
  if ((typeof navigator !== 'undefined' && !navigator.onLine) || err instanceof TypeError || name === 'AuthRetryableFetchError') {
    return 'offline';
  }
  if (name === 'AuthSessionMissingError' || message.includes('No signed-in user')) return 'session_lost';
  return 'failed';
}
