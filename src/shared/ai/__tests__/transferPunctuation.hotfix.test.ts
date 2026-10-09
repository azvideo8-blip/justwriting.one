// Диктовка 0.9.34 (прод, две минуты речи): модель расставила знаки, но «починила»
// пару слов распознавания — и проверка «все слова совпали» выбросила всю
// пунктуацию. transferPunctuation переносит знаки на исходные слова.
// Мутация: в punctuateDictation вернуть «нет совпадения слов → исходник» —
// красный тест punctuateDictation.d3 «модель исправила слово…».
import { describe, it, expect } from 'vitest';
import { transferPunctuation } from '../transferPunctuation';
import { sameWords } from '../sameWords';

describe('transferPunctuation', () => {
  it('те же слова — результат совпадает с ответом модели', () => {
    const raw = 'вчера ходили в парк потом пили чай';
    const model = 'Вчера ходили в парк, потом пили чай.';
    expect(transferPunctuation(raw, model)?.text).toBe(model);
  });

  it('модель «исправила» слова — знаки остаются, слова исходные', () => {
    const raw = 'общем поводу значит приснилась мне история толли смешная толли грустная';
    const model = 'В общем, по поводу: значит, приснилась мне история — то ли смешная, то ли грустная.';
    const r = transferPunctuation(raw, model)!;
    expect(sameWords(raw, r.text)).toBe(true);
    expect(r.text).toContain('Общем, поводу: значит, приснилась мне история —');
    expect(r.text.endsWith('грустная.')).toBe(true);
    expect(r.coverage).toBeCloseTo(0.8);
  });

  it('дефис и абзацы модели переносятся', () => {
    const raw = 'что то случилось вот и всё дальше другое';
    const model = 'Что-то случилось. Вот и всё.\n\nДальше — другое.';
    expect(transferPunctuation(raw, model)?.text).toBe(model);
  });

  it('ответ не про этот текст — покрытие низкое', () => {
    const r = transferPunctuation('раз два три четыре пять шесть', 'Совсем другой ответ модели.')!;
    expect(r.coverage).toBe(0);
    expect(sameWords('раз два три четыре пять шесть', r.text)).toBe(true);
  });

  it('слова исходника не меняются при любых вставках и пропусках модели', () => {
    const raw = 'а б в г д е ж з и к';
    const cases = ['А, б! В г. Д е ж з и к.', 'Х а, б в лишнее г д е ж з и к?', 'А б г д е ж з и к.', ''];
    for (const model of cases) {
      const r = transferPunctuation(raw, model)!;
      expect(sameWords(raw, r.text)).toBe(true);
    }
  });

  it('ё и прочие буквы исходника сохраняются, заглавная — от модели', () => {
    expect(transferPunctuation('ёлка стоит', 'Елка стоит.')?.text).toBe('Ёлка стоит.');
  });
});
