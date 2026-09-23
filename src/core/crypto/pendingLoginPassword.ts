/**
 * D-28: один пароль — пароль входа и пароль шифрования совпадают. Расходятся
 * они после сброса пароля по почте: вход уже по новому, сейф ещё по старому.
 * Если сейф при входе не открылся паролем входа, пароль входа держится здесь —
 * только в памяти вкладки, никогда в storage — до ручной разблокировки старым
 * паролем, после которой unlockVault перешифровывает сейф паролем входа.
 * Перезагрузка вкладки стирает его: тогда сведение произойдёт при следующем входе.
 */
const pending = new Map<string, string>();

export function setPendingLoginPassword(userId: string, password: string): void {
  pending.set(userId, password);
}

export function takePendingLoginPassword(userId: string): string | undefined {
  const value = pending.get(userId);
  pending.delete(userId);
  return value;
}

export function clearPendingLoginPassword(userId?: string): void {
  if (userId) pending.delete(userId);
  else pending.clear();
}
