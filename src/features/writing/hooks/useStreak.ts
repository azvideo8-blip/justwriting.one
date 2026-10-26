import { useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { Session } from '../../../types';
import { calculateStreakInfo } from '../../../core/utils/utils';
import { getFrozenDates } from '../../../core/utils/streakFreeze';

export interface StreakView {
  days: number;
  /** RA1-6: пропуск закрыт записанной заморозкой — серия не обнулилась. */
  freezeUsed: boolean;
}

export function useStreak(sessionGroups: { date: Date; sessions: Session[] }[], userId?: string | null): StreakView {
  const sessions = useMemo(() => sessionGroups.flatMap(g => g.sessions), [sessionGroups]);
  return useMemo(() => {
    const info = calculateStreakInfo(sessions);
    // BR-11 (б) + самопроверка 25.10: строка «Серия сохранена…» обязана
    // говорить про заморозку, которая ЗАПИСАНА. Записывать её отсюда
    // (первая версия правки) нельзя: `saveFrozenDates` отправляет в облако
    // локальный набор, а слияние с облачным (`syncStreakFreezesWithCloud`)
    // делает профиль — главный экран без слияния перезаписал бы чужой набор и
    // потерял прощённый день второго устройства. Так что здесь только чтение:
    // серии с незаписанным мостом строку не показывает.
    const saved = getFrozenDates(userId);
    // Ревью 26.10: `freezeDays` — все мосты серии, и старый записанный мост
    // держал строку до конца серии (до месяца). Строка — про свежий пропуск:
    // мост вчера или позавчера.
    const recentFrom = format(subDays(new Date(), 2), 'yyyy-MM-dd');
    const freezeUsed = info.days > 0 && info.freezeDays.some(d => d >= recentFrom)
      && info.freezeDays.every(d => saved.has(d));
    return { days: info.days, freezeUsed };
  }, [sessions, userId]);
}
