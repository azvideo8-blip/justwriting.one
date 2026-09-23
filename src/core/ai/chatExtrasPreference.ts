/**
 * EA-18: после сообщения в чате приложение само делает служебные запросы с
 * тем же разговором — подсказки следующего хода и извлечение фактов в память
 * ИИ. Человек может их выключить; основной ответ и название диалога остаются.
 * Хранится по аккаунту на устройстве, по умолчанию включено.
 */
const KEY = (uid: string) => `ai_chat_extras_${uid}`;

export function getChatExtrasEnabled(userId?: string | null): boolean {
  if (!userId) return true;
  try {
    return localStorage.getItem(KEY(userId)) !== '0';
  } catch {
    return true;
  }
}

export function setChatExtrasEnabled(userId: string | null | undefined, enabled: boolean): void {
  if (!userId) return;
  try {
    localStorage.setItem(KEY(userId), enabled ? '1' : '0');
  } catch { /* ignore */ }
}
