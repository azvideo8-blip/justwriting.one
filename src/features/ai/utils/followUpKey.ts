import type { DialogueMessage } from '../../../core/storage/localDb';

/**
 * Ключ «для этого ответа подсказки уже спрашивали». Раньше в него входили id
 * диалога и длина списка: у нового диалога id сначала 'new', после первого
 * ответа — настоящий, и подсказки к тому же ответу запрашивались второй раз
 * (аудит диалогов, раунд 2: 1,3–2 служебных вызова подсказок на ход).
 * Ключ — сама реплика: её id, вариант и начало текста (перегенерация меняет их).
 */
// Разбор 18.11: подсказки — только к свежему ответу. Открытие старого диалога
// спрашивало модель заново и съедало служебный лимит (47 из 60 вызовов за день).
const FOLLOW_UP_FRESH_MS = 2 * 60_000;

export function followUpKey(messages: readonly DialogueMessage[], now = Date.now()): { key: string; lastAssistant: string | null; fresh: boolean } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'assistant' && m.type !== 'system') {
      // Дейлик 20.11: перегенерация оставляет ответу прежний createdAt (порядок
      // реплик), но ставит updatedAt — свежесть по более позднему из двух, иначе
      // к новому варианту старого ответа подсказки не спрашивались.
      const stamp = Math.max(m.createdAt ?? -Infinity, m.updatedAt ?? -Infinity);
      const fresh = Number.isFinite(stamp) && now - stamp < FOLLOW_UP_FRESH_MS;
      return { key: `${m.id ?? ''}:${m.variantIndex ?? 0}:${m.content.slice(0, 100)}`, lastAssistant: m.content, fresh };
    }
  }
  return { key: 'none', lastAssistant: null, fresh: false };
}
