import type { DialogueMessage } from '../../../core/storage/localDb';

/**
 * Ключ «для этого ответа подсказки уже спрашивали». Раньше в него входили id
 * диалога и длина списка: у нового диалога id сначала 'new', после первого
 * ответа — настоящий, и подсказки к тому же ответу запрашивались второй раз
 * (аудит диалогов, раунд 2: 1,3–2 служебных вызова подсказок на ход).
 * Ключ — сама реплика: её id, вариант и начало текста (перегенерация меняет их).
 */
export function followUpKey(messages: readonly DialogueMessage[]): { key: string; lastAssistant: string | null } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'assistant' && m.type !== 'system') {
      return { key: `${m.id ?? ''}:${m.variantIndex ?? 0}:${m.content.slice(0, 100)}`, lastAssistant: m.content };
    }
  }
  return { key: 'none', lastAssistant: null };
}
