// RA1-7: «В этот день» — окно ±1 день, детерминированный выбор, корзина не
// воспоминание, закрытие только на сегодня (хранится дата, не id).
// Фальсификация: вернуть точное совпадение → красный «±1 день»; вернуть
// хранение id/навсегда → красный «завтра снова».
import { describe, it, expect } from 'vitest';
import { subDays, subYears, format } from 'date-fns';
import {
  findMatch,
  readDismissedDay,
  writeDismissedDay,
  onThisDayDismissKey,
} from '../../../../core/components/OnThisDayCard';
import type { ArchiveSession } from '../../../../shared/types/common';

const t = (k: string) => k;
const REF = new Date(2026, 9, 24, 12); // 2026-10-24

function session(id: string, date: Date, extra: Partial<ArchiveSession> = {}): ArchiveSession {
  return {
    id,
    userId: 'u1',
    content: `текст ${id}`,
    duration: 60,
    wordCount: 10,
    charCount: 50,
    wpm: 0,
    title: `Заголовок ${id}`,
    tags: [],
    createdAt: date,
    sessionStartTime: date.getTime(),
    ...extra,
  };
}

describe('RA1-7: окно и выбор «В этот день»', () => {
  it('год назад ±1 день — совпадение', () => {
    const exact = subYears(REF, 1);
    expect(findMatch([session('minus', subDays(exact, 1))], t, REF)?.session.id).toBe('minus');
    expect(findMatch([session('plus', new Date(exact.getTime() + 86_400_000))], t, REF)?.session.id).toBe('plus');
  });

  it('два дня разницы — не совпадение', () => {
    const exact = subYears(REF, 1);
    expect(findMatch([session('far', subDays(exact, 2))], t, REF)).toBeNull();
  });

  it('две записи-кандидата: показывается одна, ближайшая по дате', () => {
    const exact = subYears(REF, 1);
    const sessions = [
      session('near', new Date(exact.getTime() + 86_400_000)),
      session('exact', exact),
    ];
    expect(findMatch(sessions, t, REF)?.session.id).toBe('exact');
    // Порядок входа не решает.
    expect(findMatch([...sessions].reverse(), t, REF)?.session.id).toBe('exact');
  });

  it('заметка в корзине не показывается', () => {
    const exact = subYears(REF, 1);
    expect(findMatch([session('trashed', exact, { trashedAt: REF.getTime() })], t, REF)).toBeNull();
  });

  it('скрытие хранит дату, а не id: завтра карточка снова видна', () => {
    localStorage.removeItem(onThisDayDismissKey('u1'));
    const today = format(new Date(), 'yyyy-MM-dd');
    writeDismissedDay('u1', today);
    expect(readDismissedDay('u1')).toBe(today);
    // BR-12: `not.toBe('2026-10-25')` красным стать не могло — сравнение
    // «закрыто именно сегодня» проверяется на самой карточке
    // (`onThisDayRefresh.br12.test.tsx`: закрыто сегодня — карточки нет,
    // закрыто вчера — есть). Здесь — только то, что хранится дата дня.
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(readDismissedDay('u1')).not.toBe(format(subDays(new Date(), 1), 'yyyy-MM-dd'));
    // Ключ привязан к аккаунту: у другого человека своё закрытие.
    expect(readDismissedDay('u2')).toBeNull();
  });
});
