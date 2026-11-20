// DI-2: сверка цитаты служебного вызова «выпиши вывод». Синтетика.
// Мутации: (1) убрать flat(reply).includes(...) — красный «цитата не из ответа»;
// (2) убрать проверку длины — красный «короче 20 / длиннее 400».
import { describe, it, expect } from 'vitest';
import { parseInsightPick, buildInsightQuoteUserMessage, INSIGHT_PICK_SYSTEM_PROMPT } from '../insightPickPrompt';

const REPLY = 'Это предположение, не вердикт. В записях повторяется одно: [#N14] «всё» не кончается никогда, а своё и приятное идёт только после дел — ты ждёшь разрешения. Похоже на тебя?';
const QUOTE = 'своё и приятное идёт только после дел — ты ждёшь разрешения';
const json = (o: unknown) => JSON.stringify(o);

describe('parseInsightPick', () => {
  it('дословная цитата из ответа — остаётся', () => {
    expect(parseInsightPick(json({ found: true, quote: QUOTE }), REPLY)).toBe(QUOTE);
  });

  it('после нормализации кавычек, тире и «ё» — остаётся; ссылки [#id] из цитаты вычищаются', () => {
    const reply = 'Ты всё откладываешь — «на потом» — потому что боишься ошибиться при ребёнке [#N01].';
    const quote = 'Ты все откладываешь - "на потом" - потому что боишься ошибиться при ребенке';
    expect(parseInsightPick(json({ found: true, quote }), reply)).toBe(quote);
    expect(parseInsightPick(json({ found: true, quote: 'Ты всё откладываешь — «на потом» [#N01] — потому что боишься ошибиться' }), reply)).not.toContain('[#');
  });

  it('цитаты нет в ответе — null', () => {
    expect(parseInsightPick(json({ found: true, quote: 'ты боишься, что тебя не поймут и потому молчишь' }), REPLY)).toBeNull();
  });

  it('короче 20 или длиннее 400 знаков — null', () => {
    expect(parseInsightPick(json({ found: true, quote: 'ты ждёшь разрешения' }), REPLY)).toBeNull();
    const long = 'слово '.repeat(70);
    expect(parseInsightPick(json({ found: true, quote: long }), long)).toBeNull();
  });

  it('found:false и не-JSON — null', () => {
    expect(parseInsightPick(json({ found: false, quote: '' }), REPLY)).toBeNull();
    expect(parseInsightPick(json({ found: false, quote: QUOTE }), REPLY)).toBeNull();
    expect(parseInsightPick('вывод такой: ты ждёшь разрешения', REPLY)).toBeNull();
    expect(parseInsightPick('{сломанный json', REPLY)).toBeNull();
  });

  it('JSON внутри текста модели находится', () => {
    expect(parseInsightPick(`Вот ответ: ${json({ found: true, quote: QUOTE })}`, REPLY)).toBe(QUOTE);
  });
});

describe('сообщение и промпт', () => {
  it('сообщение обрамлено маркерами, реплика человека необязательна', () => {
    expect(buildInsightQuoteUserMessage('', 'ответ')).toBe('[EXCHANGE_START]\nСобеседник: ответ\n[EXCHANGE_END]');
    expect(buildInsightQuoteUserMessage('вопрос', 'ответ')).toContain('Человек: вопрос');
  });

  it('промпт просит found и quote, поля text (пересказ) нет', () => {
    expect(INSIGHT_PICK_SYSTEM_PROMPT).toContain('found');
    expect(INSIGHT_PICK_SYSTEM_PROMPT).toContain('quote');
    expect(INSIGHT_PICK_SYSTEM_PROMPT).not.toMatch(/\btext\b/);
  });
});
