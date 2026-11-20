/**
 * К28-1 (случай #28, ход 9): в строгом ходе ответ пересказал содержание ПРОШЛОЙ записи
 * (её привела модель в прошлом ответе) и поставил ссылку на приложенную сегодняшнюю.
 * Содержание верное, ошибается ссылка. Кодом, после ответа, без вызова модели:
 *   предложение со ссылкой на приложенную запись, у которого доля основ (5 букв, как
 *   `stemsOf` в answerAudit) в тексте приложенной ниже порога AG-1 при ≥ 4 основах:
 *     - в прошлых ответах диалога есть предложение с ДРУГОЙ ссылкой и общей долей основ ≥ 0,5 →
 *       ссылка заменяется той;
 *     - иначе ссылка снимается, текст остаётся.
 * Предложение целиком не удаляется. Счётчик weak_ref на сервере не трогается.
 *
 * ponytail: сверка по основам слов, не по смыслу; пересказ другими словами пройдёт как есть.
 */
import { stemsOf } from './answerAudit';

/** Порог AG-1: доля основ предложения в тексте записи, ниже которой ссылка считается слабой. */
export const STRICT_REF_WEAK_SHARE = 0.3;
/** Доля основ предложения, найденная в предложении прошлого ответа, с которой ссылка заменяется. */
export const PRIOR_MATCH_SHARE = 0.5;
const MIN_STEMS = 4;

const ANY_REF = /\[#([^\]\s]{1,120}?)(?:\s*·[^\]]*)?\]/g;
const SPLIT = /(?<=[.!?…])(\s+)/;

const fold = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');

export function repairStrictNoteRefs(
  answer: string,
  note: { noteId: string; noteText: string },
  priorAnswers: string[],
  /** Номера, на которые ссылаться разрешено (не скрытые от ИИ и не удалённые): чужая ссылка вне набора не подставляется. */
  allowedIds?: ReadonlySet<string>,
): string {
  if (!answer.includes(`[#${note.noteId}`)) return answer;
  const noteHay = fold(note.noteText);

  // Предложения прошлых ответов с чужой ссылкой — кандидаты для замены.
  const priors: { id: string; stems: Set<string> }[] = [];
  for (const prior of priorAnswers) {
    for (const sentence of prior.split(SPLIT)) {
      for (const m of sentence.matchAll(ANY_REF)) {
        const id = m[1] ?? '';
        if (id && id !== note.noteId && (!allowedIds || allowedIds.has(id))) priors.push({ id, stems: new Set(stemsOf(sentence.replace(ANY_REF, ''))) });
      }
    }
  }

  const ownRef = new RegExp(`\\s?\\[#${note.noteId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*·[^\\]]*)?\\]`, 'g');
  return answer
    .split(SPLIT)
    .map(part => {
      if (!part.includes(`[#${note.noteId}`)) return part;
      const stems = stemsOf(part.replace(ANY_REF, ''));
      if (stems.length < MIN_STEMS) return part;
      if (stems.filter(s => noteHay.includes(s)).length / stems.length >= STRICT_REF_WEAK_SHARE) return part;
      let best: { id: string; share: number } | null = null;
      for (const p of priors) {
        const share = stems.filter(s => p.stems.has(s)).length / stems.length;
        if (share >= PRIOR_MATCH_SHARE && (!best || share > best.share)) best = { id: p.id, share };
      }
      // Пробел перед знаком убираем только в тронутом предложении: остальной ответ — как написан.
      return part.replace(ownRef, best ? ` [#${best.id}]` : '').replace(/[ \t]+([.!?…,;:])/g, '$1');
    })
    .join('');
}
