import { useState } from 'react';
import { format } from 'date-fns';
import { useReturnNote } from './useReturnNote';
import { useOnThisDayHome } from './useOnThisDayHome';

export function returnDismissKey(userId: string): string {
  return `home_return_dismissed_${userId || 'guest'}`;
}

function readDay(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * Главный экран (владелец 26.10): одна подсказка за раз. «Продолжить» — первой;
 * «В этот день» — только когда её нет или её скрыли крестиком (до завтра).
 * Пока карточка возврата читается, напоминание не показываем — иначе оно
 * мелькнёт и сменится «Продолжить».
 */
export function useHomeHint(userId: string, idle: boolean) {
  const note = useReturnNote(userId);
  const key = returnDismissKey(userId);
  const today = format(new Date(), 'yyyy-MM-dd');
  // Дата хранится вместе с ключом: сменился владелец — читаем его отметку.
  const [dismissed, setDismissed] = useState(() => ({ key, day: readDay(key) }));
  const dismissedDay = dismissed.key === key ? dismissed.day : readDay(key);
  const returnNote = dismissedDay === today ? null : note;
  const onThisDay = useOnThisDayHome(userId, idle && returnNote === null);
  const dismissReturn = () => {
    try { localStorage.setItem(key, today); } catch { /* скроется до перезагрузки */ }
    setDismissed({ key, day: today });
  };
  return { returnNote: returnNote ?? null, dismissReturn, onThisDay };
}
