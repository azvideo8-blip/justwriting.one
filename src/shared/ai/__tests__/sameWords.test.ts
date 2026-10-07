import { describe, it, expect } from 'vitest';
import { sameWords } from '../sameWords';

const DICTATED = 'сегодня я долго думала о переезде мама опять звонила и спросила когда ты наконец решишь кто то же должен решить';

describe('sameWords — ИИ расставил только знаки', () => {
  it('знаки, заглавные, абзацы и дефис — те же слова', () => {
    const fixed = 'Сегодня я долго думала о переезде.\n\nМама опять звонила и спросила: «Когда ты наконец решишь?» Кто-то же должен решить.';
    expect(sameWords(DICTATED, fixed)).toBe(true);
  });

  it('ё вместо е — не правка слова', () => {
    expect(sameWords('еще', 'Ещё.')).toBe(true);
  });

  it('изменённое, добавленное, убранное или переставленное слово — отказ', () => {
    expect(sameWords(DICTATED, DICTATED.replace('думала', 'размышляла'))).toBe(false);
    expect(sameWords(DICTATED, DICTATED + ' вот')).toBe(false);
    expect(sameWords(DICTATED, DICTATED.replace(' опять', ''))).toBe(false);
    expect(sameWords('я долго думала', 'Долго я думала.')).toBe(false);
  });

  it('обрезанный ответ (кончились токены) — отказ', () => {
    expect(sameWords(DICTATED, 'Сегодня я долго думала о переезде.')).toBe(false);
  });
});
