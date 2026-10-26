import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { format, subDays } from 'date-fns';
import { Session } from '../../types';
import { toDate } from './dateUtils';
import { getFrozenDates, saveFrozenDates } from './streakFreeze';

export const parseCloudDate = toDate;

// Register the design-system's custom font-size utilities (defined in index.css)
// so tailwind-merge treats them as font sizes (e.g. a bespoke `text-label` must
// override a primitive's default `text-sm`). Mirrors shared/utils/cn.ts.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["label", "label-sm"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getSessionDate(session: Session): Date | null {
  let date: Date | null;
  if (session.sessionStartTime) {
    date = new Date(session.sessionStartTime);
  } else {
    date = parseCloudDate(session.createdAt);
  }
  if (!date || isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** DEEP-2: Возвращает даты всех подходов к заметке (через sittings),
 *  либо дату единственной сессии. Гарантирует, что стрик и активность
 *  не теряют дни при редактировании старых заметок. */
export function getSessionDates(session: Session): Date[] {
  if (session.sittings && session.sittings.length > 0) {
    const dates: Date[] = [];
    for (const sitting of session.sittings) {
      const ts = sitting.savedAt || sitting.sessionStartedAt;
      if (ts) {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) {
          dates.push(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
        }
      }
    }
    if (dates.length > 0) return dates;
  }
  const single = getSessionDate(session);
  return single ? [single] : [];
}

export interface StreakInfo {
  days: number;
  /** Пропуск закрыт заморозкой в этом расчёте — интерфейс говорит об этом. */
  freezeUsed: boolean;
  /**
   * BR-11 (б): какие именно дни закрыты мостом. Нужен, чтобы отличить
   * «расчёт предположил прощение» от «прощение записано»: строка
   * «Серия сохранена…» имеет право появляться только по второму.
   */
  freezeDays: string[];
}

export function calculateStreak(sessions: Session[], frozen?: Set<string>, userId?: string | null): number {
  return calculateStreakInfo(sessions, frozen, userId).days;
}

export function calculateStreakInfo(sessions: Session[], frozen?: Set<string>, userId?: string | null): StreakInfo {
  if (sessions.length === 0) return { days: 0, freezeUsed: false, freezeDays: [] };

  const dates = sessions
    .flatMap(s => getSessionDates(s))
    .map(d => format(d, 'yyyy-MM-dd'));
  if (dates.length === 0) return { days: 0, freezeUsed: false, freezeDays: [] };
  const today = format(new Date(), 'yyyy-MM-dd');
  const uniqueDates = Array.from(new Set(dates))
    .filter(d => d <= today)
    .sort((a, b) => b.localeCompare(a));

  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const frozenDates = frozen ? new Set(frozen) : getFrozenDates(userId);
  const frozenMonths = new Set<string>();
  for (const d of frozenDates) frozenMonths.add(d.substring(0, 7));
  let freezeUsed = false;
  const freezeDaySet = new Set<string>();

  let checkDate: Date;
  if (uniqueDates[0] === today) {
    checkDate = new Date();
  } else if (uniqueDates[0] === yesterday) {
    checkDate = subDays(new Date(), 1);
  } else if (uniqueDates[0] === format(subDays(new Date(), 2), 'yyyy-MM-dd')) {
    // RA1-6: один пустой день (вчера) прощается, если заморозка на этот месяц
    // ещё свободна. Цикл ниже посчитает вчерашний день как мост — так же, как
    // считает дырку внутри серии.
    const missedMonth = yesterday.substring(0, 7);
    if (!frozenDates.has(yesterday) && frozenMonths.has(missedMonth)) {
      return { days: 0, freezeUsed: false, freezeDays: [] };
    }
    if (!frozenDates.has(yesterday)) {
      frozenDates.add(yesterday);
      frozenMonths.add(missedMonth);
      freezeUsed = true;
    }
    freezeDaySet.add(yesterday);
    checkDate = subDays(new Date(), 1);
  } else {
    return { days: 0, freezeUsed: false, freezeDays: [] };
  }

  let streak = 0;

  let i = 0;
  while (i < uniqueDates.length) {
    if (uniqueDates[i] === format(checkDate, 'yyyy-MM-dd')) {
      streak++;
      checkDate = subDays(checkDate, 1);
      i++;
    } else {
      const nextExpected = format(subDays(checkDate, 1), 'yyyy-MM-dd');
      if (uniqueDates[i] === nextExpected) {
        const missedDay = format(checkDate, 'yyyy-MM-dd');
        const missedMonth = missedDay.substring(0, 7);
        const alreadyFrozen = frozenDates.has(missedDay);
        if (alreadyFrozen || !frozenMonths.has(missedMonth)) {
          if (!alreadyFrozen) {
            frozenDates.add(missedDay);
            frozenMonths.add(missedMonth);
            freezeUsed = true;
          }
          freezeDaySet.add(missedDay);
          streak++;
          checkDate = subDays(checkDate, 1);
          continue;
        }
      }
      break;
    }
  }

  return { days: streak, freezeUsed, freezeDays: [...freezeDaySet] };
}

export function consumeStreakFreezes(sessions: Session[], userId?: string | null): Set<string> {
  if (sessions.length === 0) return getFrozenDates(userId);

  const dates = sessions
    .flatMap(s => getSessionDates(s))
    .map(d => format(d, 'yyyy-MM-dd'));
  if (dates.length === 0) return getFrozenDates(userId);
  const today = format(new Date(), 'yyyy-MM-dd');
  const uniqueDates = Array.from(new Set(dates))
    .filter(d => d <= today)
    .sort((a, b) => b.localeCompare(a));

  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const twoDaysAgo = format(subDays(new Date(), 2), 'yyyy-MM-dd');

  const frozenDates = getFrozenDates(userId);
  const frozenMonths = new Set<string>();
  for (const d of frozenDates) frozenMonths.add(d.substring(0, 7));
  let freezesChanged = false;

  let checkDate: Date;
  if (uniqueDates[0] === today) {
    checkDate = new Date();
  } else if (uniqueDates[0] === yesterday) {
    checkDate = subDays(new Date(), 1);
  } else if (uniqueDates[0] === twoDaysAgo) {
    // BR-11 (а): RA1-6 прощает вчерашний день и `calculateStreak` считает
    // серию с этим мостом — значит, и сохранение обязано его записать.
    // Раньше функция выхода не доходила до этого случая, прощение оставалось
    // несчитанным, а месяц можно было морозить повторно.
    const missedMonth = yesterday.substring(0, 7);
    if (!frozenDates.has(yesterday) && frozenMonths.has(missedMonth)) {
      // Права на мост нет: серия нулевая, сохранять нечего.
      return frozenDates;
    }
    if (!frozenDates.has(yesterday)) {
      frozenDates.add(yesterday);
      frozenMonths.add(missedMonth);
      freezesChanged = true;
    }
    checkDate = subDays(new Date(), 1);
  } else {
    return frozenDates;
  }
  
  let i = 0;
  while (i < uniqueDates.length) {
    if (uniqueDates[i] === format(checkDate, 'yyyy-MM-dd')) {
      checkDate = subDays(checkDate, 1);
      i++;
    } else {
      const nextExpected = format(subDays(checkDate, 1), 'yyyy-MM-dd');
      if (uniqueDates[i] === nextExpected) {
        const missedDay = format(checkDate, 'yyyy-MM-dd');
        const missedMonth = missedDay.substring(0, 7);
        const alreadyFrozen = frozenDates.has(missedDay);
        if (alreadyFrozen || !frozenMonths.has(missedMonth)) {
          if (!alreadyFrozen) {
            frozenDates.add(missedDay);
            frozenMonths.add(missedMonth);
            freezesChanged = true;
          }
          checkDate = subDays(checkDate, 1);
          continue;
        }
      }
      break;
    }
  }
  
  if (freezesChanged) {
    saveFrozenDates(frozenDates, userId);
  }
  return frozenDates;
}

// Как и calculateStreak — чистая: заморозки читаются, но не записываются.
// Обе вызываются из рендера (StreakRibbon, Achievements), а запись заморозок
// делает только consumeStreakFreezes на полном наборе сессий. Раньше эта
// функция писала свой Set поверх чужого: два вычислителя строили Set из
// getFrozenDates() в разное время, и тот, кто сохранял последним, откатывал
// добавленное первым.
export function calculateBestStreak(sessions: Session[], frozen?: Set<string>, userId?: string | null): number {
  if (sessions.length === 0) return 0;
  const today = format(new Date(), 'yyyy-MM-dd');
  const dates = new Set(
    sessions.flatMap(s => getSessionDates(s))
      .map(d => format(d, 'yyyy-MM-dd'))
      .filter(d => d <= today)
  );
  const sorted = [...dates]
    .map(d => {
      const [y, m, day] = d.split('-').map(Number);
      return new Date(y!, m! - 1, day!).getTime();
    })
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  
  const frozenDates = new Set(frozen ?? getFrozenDates(userId));
  const frozenMonths = new Set<string>();
  for (const d of frozenDates) frozenMonths.add(d.substring(0, 7));

  let max = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diffDays = Math.round((sorted[i]! - sorted[i - 1]!) / 86400000);
    if (diffDays === 1) { cur++; max = Math.max(max, cur); }
    else if (diffDays === 2) {
      const prevDate = new Date(sorted[i - 1]!);
      prevDate.setDate(prevDate.getDate() + 1);
      const missedDay = format(prevDate, 'yyyy-MM-dd');
      const missedMonth = missedDay.substring(0, 7);
      const alreadyFrozen = frozenDates.has(missedDay);
      if (alreadyFrozen || !frozenMonths.has(missedMonth)) {
        // Локально считаем месяц израсходованным, чтобы вторая дырка в том же
        // месяце уже не прощалась. Наружу это не сохраняется.
        if (!alreadyFrozen) {
          frozenDates.add(missedDay);
          frozenMonths.add(missedMonth);
        }
        cur += 2;
        max = Math.max(max, cur);
      } else {
        cur = 1;
      }
    }
    else if (diffDays > 2) { cur = 1; }
  }
  return max;
}
