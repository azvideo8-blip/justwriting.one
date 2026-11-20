// К28-3 (случаи #27/#28): слова модели в реплике человека не должны проходить сверку памяти.
// Таблица случаев — синтетика; мутации: порог 8 → 4 (красный на «7 слов не вырезаются»);
// пустая функция (вычитания нет) — красный на остальных.
import { describe, it, expect } from 'vitest';
import { stripEchoedAssistantText, groundedInUser } from '../memoryGrounding';

const MODEL = 'Похоже, ты откладываешь разговор с начальником, потому что боишься услышать отказ и потерять уверенность.';
const NUMS = 'один два три четыре пять шесть семь восемь девять десять';

describe('stripEchoedAssistantText', () => {
  it('фраза модели в кавычках + «похоже» — остаётся «похоже»', () => {
    const user = '«ты откладываешь разговор с начальником, потому что боишься услышать отказ» — похоже';
    const out = stripEchoedAssistantText(user, [MODEL]);
    expect(out).toContain('похоже');
    expect(out).not.toContain('откладываешь');
  });

  it('кавычки-лапки "..." и регистр/ё: то же самое', () => {
    const out = stripEchoedAssistantText('"ТЫ ОТКЛАДЫВАЕШЬ РАЗГОВОР С НАЧАЛЬНИКОМ" да, пожалуй', ['Ты откладываешь разговор с начальником.']);
    expect(out).toBe('да, пожалуй');
    expect(stripEchoedAssistantText('«всё ещё тянет»', ['Тебя все еще тянет.'])).toBe('');
  });

  it('то же своими словами — без изменений', () => {
    const own = 'Думаю, я просто боюсь, что мне откажут, и тяну с разговором';
    expect(stripEchoedAssistantText(own, [MODEL])).toBe(own);
  });

  it('кавычки с текстом, которого у модели не было, — остаются', () => {
    const user = 'Он сказал «никогда больше не приходи сюда» и ушёл';
    expect(stripEchoedAssistantText(user, [MODEL])).toBe(user);
  });

  it('совпадение в 7 слов — не вырезается', () => {
    const user = 'да вот один два три четыре пять шесть семь и всё';
    expect(stripEchoedAssistantText(user, [NUMS])).toBe(user);
  });

  it('совпадение в 8 слов — вырезается, остальное остаётся', () => {
    const user = 'да вот один два три четыре пять шесть семь восемь и всё';
    expect(stripEchoedAssistantText(user, [NUMS])).toBe('да вот и всё');
  });

  // Ревью exec-2026-11-20: кавычки сверяются по словам целиком, не подстрокой.
  it('своё слово в кавычках, у модели — другое слово с тем же началом, — остаётся', () => {
    const out = stripEchoedAssistantText('Да, я «устал», вот и всё', ['Похоже, это устало звучит.']);
    expect(out).toContain('устал');
  });

  it('без ответов модели — реплика как есть', () => {
    expect(stripEchoedAssistantText('любая реплика', [])).toBe('любая реплика');
  });

  it('следствие для сверки памяти: пересказ модели проходит только благодаря вставке', () => {
    const memory = 'Откладывает разговор с начальником, потому что боится услышать отказ';
    const user = '«ты откладываешь разговор с начальником, потому что боишься услышать отказ» — похоже';
    expect(groundedInUser(memory, user)).toBe(true);
    expect(groundedInUser(memory, stripEchoedAssistantText(user, [MODEL]))).toBe(false);
  });
});
