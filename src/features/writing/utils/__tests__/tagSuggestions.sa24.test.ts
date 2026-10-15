// SA-24: подсказки тегов — только существующие теги человека, совпавшие с текстом.
import { describe, it, expect } from 'vitest';
import { stem, suggestExistingTags } from '../tagSuggestions';

describe('SA-24: suggestExistingTags', () => {
  const text = 'Сегодня глина была послушной. Впервые за неделю руки сами знали, что делать.';

  it('words of the text are never offered without existing tags', () => {
    expect(suggestExistingTags(text, [])).toEqual([]);
  });

  it('matches word forms by stem: глина ↔ глину, утро ↔ утром', () => {
    expect(stem('глина')).toBe(stem('глину'));
    expect(stem('утро')).toBe(stem('утром'));
    expect(suggestExistingTags('Рано утром я месила глину.', ['глина', 'утро', 'море']).sort()).toEqual(['глина', 'утро']);
  });

  it('at most two, more frequent first; a multi-word tag needs all its words', () => {
    const t = 'глина глина глина утром утром работа';
    expect(suggestExistingTags(t, ['работа', 'утро', 'глина'])).toEqual(['глина', 'утро']);
    expect(suggestExistingTags('утро в мастерской', ['утро в саду'])).toEqual([]);
  });

  it('ignores the # prefix and duplicates', () => {
    expect(suggestExistingTags('глина', ['#глина', 'Глина'])).toEqual(['глина']);
  });
});
