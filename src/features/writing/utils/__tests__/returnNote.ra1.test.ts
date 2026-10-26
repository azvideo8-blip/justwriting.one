// RA1-3: после паузы главный показывает «Продолжить» и дату последней записи.
// Выбор последней: только не в корзине, только прошлые дни (сегодняшняя —
// не «после паузы»), самая свежая из подходящих. Текста заметки здесь нет
// вовсе — это решение владельца 2026-10-24.
import { describe, it, expect } from 'vitest';
import { pickReturnNote } from '../returnNote';
import type { LocalDocument } from '../../../../core/storage/localDb';

const DAY = 24 * 60 * 60 * 1000;
const START_OF_TODAY = new Date(2026, 9, 24).getTime();

function doc(id: string, lastAgoMs: number, extra: Partial<LocalDocument> = {}): LocalDocument {
  return {
    id,
    guestId: 'u1',
    title: `Заголовок ${id}`,
    currentVersion: 1,
    totalWords: 10,
    totalDuration: 60,
    sessionsCount: 1,
    firstSessionAt: START_OF_TODAY - lastAgoMs,
    lastSessionAt: START_OF_TODAY - lastAgoMs,
    tags: [],
    ...extra,
  };
}

describe('RA1-3: выбор последней записи для возврата', () => {
  it('берёт самую свежую запись прошлых дней', () => {
    const docs = [doc('old', 14 * DAY), doc('recent', 3 * DAY), doc('mid', 5 * DAY)];
    expect(pickReturnNote(docs, START_OF_TODAY)?.id).toBe('recent');
  });

  it('пауза в две недели — та же карточка', () => {
    expect(pickReturnNote([doc('far', 14 * DAY)], START_OF_TODAY)?.id).toBe('far');
  });

  it('заметку сегодняшнего дня не предлагает — это не «после паузы»', () => {
    expect(pickReturnNote([doc('today', -1000)], START_OF_TODAY)).toBeNull();
  });

  // BR-6 (ревью 25.10): одна сегодняшняя запись покраснеть не могла — ветка
  // «пропустить и искать дальше» давала null и без правки. Настоящий сценарий:
  // сегодня писали, и в архиве есть запись трёхдневной давности.
  it('писали сегодня — карточки нет, даже если позже есть более старая запись', () => {
    const docs = [doc('today', -1000), doc('three_days_ago', 3 * DAY)];
    expect(pickReturnNote(docs, START_OF_TODAY), 'предложили вернуться к старой записи после сегодняшней').toBeNull();
  });

  it('сегодняшняя запись в корзине не считает день написанным', () => {
    const docs = [doc('today_trashed', -1000, { trashedAt: START_OF_TODAY }), doc('three_days_ago', 3 * DAY)];
    expect(pickReturnNote(docs, START_OF_TODAY)?.id).toBe('three_days_ago');
  });

  it('заметка в корзине не последняя запись', () => {
    const docs = [doc('trashed', 2 * DAY, { trashedAt: START_OF_TODAY - 2 * DAY + 1000 }), doc('alive', 4 * DAY)];
    expect(pickReturnNote(docs, START_OF_TODAY)?.id).toBe('alive');
  });

  it('нет записей — нет карточки', () => {
    expect(pickReturnNote([], START_OF_TODAY)).toBeNull();
  });
});
