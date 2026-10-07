import { describe, expect, it } from 'vitest';
import { ENGLISH_NUDGE, needsEnglishNudge } from '../languageNudge.js';

// DLG-Q4 (Fable T-7): решение — «это действительно английская реплика, а не
// русский кириллицей, ссылкой или куском кода». Ложное срабатывание стоит
// человеку ответ на чужом языке, поэтому правила консервативные и повторяют
// прототип run.mjs:43–51 один в один.
describe('Q-4: needsEnglishNudge', () => {
  it.each([
    ['I want to run a half marathon next spring, how do I start?', true],
    ['как мне keep sleeping early, если отчёт не отпускает?', false],
    ['сделай мне summary по сну за неделю', false],
    ['посмотри https://example.com/run-plan и скажи, реально ли', false],
    ['privet, kak dela? ya ustala', false],
    ['ok', false],
    ['`npm run build` fails again', false],
    ['Hello there my friend', true],
  ])('%s → %s', (text, expected) => {
    expect(needsEnglishNudge(text)).toBe(expected);
  });

  it('подсказка — короткий англоязычный маркер', () => {
    expect(ENGLISH_NUDGE).toBe('(Answer in English.)');
  });
});
