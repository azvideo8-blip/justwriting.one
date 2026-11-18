/**
 * Метка «идёт выход со стиранием» — общая для вкладок (localStorage).
 *
 * `SIGNED_OUT` приходит в соседние вкладки только после ответа сервера, а база
 * к этому времени уже стёрта: их таймеры черновика записали бы его обратно.
 * Мутатор черновика (draftWriter.applyWrite) читает метку и не пишет (Н-4).
 * Срок — чтобы метка от прерванного выхода не съела чужой черновик потом;
 * новый вход снимает её сразу (supabaseAuthProvider).
 */
const WIPE_MARK_KEY = 'jw_signout_wipe_at';
const WIPE_MARK_TTL_MS = 60_000;

export function setSignOutWipeMark(): void {
  try { localStorage.setItem(WIPE_MARK_KEY, String(Date.now())); } catch { /* приватный режим: вкладка выхода держит флаг в памяти */ }
}

export function clearSignOutWipeMark(): void {
  try { localStorage.removeItem(WIPE_MARK_KEY); } catch { /* нечего снимать */ }
}

export function signOutWipeMarkFresh(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(WIPE_MARK_KEY) ?? 0) < WIPE_MARK_TTL_MS;
  } catch {
    return false;
  }
}
