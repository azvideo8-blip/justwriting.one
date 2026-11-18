// HY-2: дата рядом со ссылкой на запись — дата этой записи, только на ходе с
// гипотезой. Трогается только однозначное: одна ссылка и одна дата в предложении.
//
// Мутации, на которых тесты краснеют:
//  - ids.length === 1 → ids.length >= 1 → красный «две ссылки — не тронуто»;
//  - dates.length !== 1 → dates.length < 1 → красный «две даты — не тронуто»;
//  - убрать fixCitedDates из guardDates в useAIChat → красный useAIChatCitedDates.hy2.test.ts.
import { describe, expect, it } from 'vitest';
import { fixCitedDates, hypothesisCitedDates } from '../citedDateGuard';
import { HYPOTHESIS_TURN_MARK } from '../../../../shared/ai/hypothesisRule';

const DATES = new Map([['A1', '2026-09-03'], ['A2', '2026-05-20']]);

describe('fixCitedDates', () => {
  it('неверная дата у ссылки заменена датой записи', () => {
    const out = fixCitedDates('В записи от 12 апреля [#A1] ты обещала себе сесть за круг.', DATES);
    expect(out).toBe('В записи от 3 сентября [#A1] ты обещала себе сесть за круг.');
  });

  it('верная дата не меняется', () => {
    const text = 'В записи от 3 сентября [#A1] ты обещала себе сесть за круг.';
    expect(fixCitedDates(text, DATES)).toBe(text);
  });

  it('в предложении две ссылки — не тронуто', () => {
    const text = '12 апреля ты писала про глину [#A1] и про кофе [#A2].';
    expect(fixCitedDates(text, DATES)).toBe(text);
  });

  it('в предложении две даты — не тронуто', () => {
    const text = '12 апреля и 3 сентября ты писала про глину [#A1].';
    expect(fixCitedDates(text, DATES)).toBe(text);
  });

  it('дата совпадает с записью («12 мая», A1 = 2026-05-12) — не тронуто', () => {
    const text = '12 мая ты купила глину [#A1].';
    expect(fixCitedDates(text, new Map([['A1', '2026-05-12']]))).toBe(text);
  });

  it('ссылка с датой внутри [#A1 · 20260903] тоже распознаётся', () => {
    const out = fixCitedDates('В записи [#A1 · 20260903] от 12 апреля ты обещала себе сесть за круг.', DATES);
    expect(out).toBe('В записи [#A1 · 20260903] от 3 сентября ты обещала себе сесть за круг.');
  });

  it('предложение без ссылки не тронуто; соседние предложения чистятся порознь', () => {
    const text = '12 апреля была суббота. В записи от 12 апреля [#A1] ты обещала себе сесть за круг.';
    expect(fixCitedDates(text, DATES)).toBe('12 апреля была суббота. В записи от 3 сентября [#A1] ты обещала себе сесть за круг.');
  });

  it('ссылки нет в материалах хода — не тронуто', () => {
    const text = 'В записи от 12 апреля [#Z9] ты обещала себе сесть за круг.';
    expect(fixCitedDates(text, DATES)).toBe(text);
  });
});

describe('hypothesisCitedDates', () => {
  const ctx = `${HYPOTHESIS_TURN_MARK}\n\n[Опоры — 2 записей разных дней]\n[#A1 · 2026-09-03]\nЗаметка 1: "Глина"\nГлина лежит.\n\n[#A2 · 2026-05-20]\nЗаметка 2: "Кофе"\nКофе остыл.`;

  it('ход с гипотезой: id → дата из шапок', () => {
    const m = hypothesisCitedDates(ctx);
    expect(m).not.toBeNull();
    expect(m?.get('A1')).toBe('2026-09-03');
    expect(m?.get('A2')).toBe('2026-05-20');
  });

  it('без метки гипотезы — null', () => {
    expect(hypothesisCitedDates('[#A1 · 2026-09-03]\nГлина лежит.')).toBeNull();
    expect(hypothesisCitedDates(null)).toBeNull();
    expect(hypothesisCitedDates(undefined)).toBeNull();
    expect(hypothesisCitedDates('')).toBeNull();
  });

  it('метка есть, шапок нет — null', () => {
    expect(hypothesisCitedDates(HYPOTHESIS_TURN_MARK)).toBeNull();
  });
});