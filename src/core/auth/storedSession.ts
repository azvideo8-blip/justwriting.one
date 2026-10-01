/**
 * S-32/S-33: uid сессии, которую supabase-js хранит в localStorage
 * (`sb-<ref>-auth-token`). Читается без клиента и синхронно — нужен там, где
 * клиент ещё не восстановил сессию (старт приложения) или уже стёр её
 * (SIGNED_OUT после неудачного refresh). Нечитаемая запись считается
 * отсутствующей — так же её трактует и сам supabase-js.
 */
export function getStoredSessionUid(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { user?: { id?: unknown } };
      if (typeof parsed?.user?.id === 'string') return parsed.user.id;
    }
  } catch {
    /* приватный режим / повреждённый JSON — сессии нет */
  }
  return null;
}
