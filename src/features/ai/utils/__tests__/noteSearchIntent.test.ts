import { describe, it, expect } from 'vitest';
import { looksLikeNoteSearch, shouldRunFullSearch } from '../aiChatTransport';

describe('looksLikeNoteSearch — verbs', () => {
  it.each([
    'просканируй все мои заметки про работу',
    'прошерсти записи за апрель',
    'поройся в заметках про Сашу',
    'пробеги по моим записям',
    'пересмотри заметки за прошлый месяц',
  ])('recognises %s', (text) => {
    expect(looksLikeNoteSearch(text)).toBe(true);
  });

  it.each([
    'напиши пост про осень',
    'спасибо, отличная мысль',
    'перепиши этот абзац покрасивее',
    'покажи мне картинку',
    'проверь орфографию',
  ])('does not fire on %s', (text) => {
    expect(looksLikeNoteSearch(text)).toBe(false);
  });

  // `\b` is ASCII-only and never matches beside Cyrillic, so these patterns
  // were dead: the search verb alone reached the model with no search run.
  it.each([
    'поищи про Сашу',
    'просканируй всё',
    'вспомни, что я говорил про отца',
  ])('fires on %s — a search verb with a target, no note noun', (text) => {
    expect(looksLikeNoteSearch(text)).toBe(true);
  });
});

describe('shouldRunFullSearch', () => {
  it('searches when nothing is attached and the intent is search', () => {
    expect(shouldRunFullSearch('поищи в заметках про маму', false)).toBe(true);
  });

  it('does not search on small talk', () => {
    expect(shouldRunFullSearch('привет, как дела', false)).toBe(false);
    expect(shouldRunFullSearch('привет, как дела', true)).toBe(false);
  });

  it('still searches when a note is attached — the regression this fixes', () => {
    // Attaching a note used to switch the archive off for the rest of the
    // dialogue, so the model answered "I only have these two notes".
    expect(shouldRunFullSearch('поищи в заметках про маму', true)).toBe(true);
    expect(shouldRunFullSearch('просканируй всё про работу', true)).toBe(true);
  });

  it('leaves the attached note alone when the request is about that note', () => {
    expect(shouldRunFullSearch('разбери эту заметку', true)).toBe(false);
    expect(shouldRunFullSearch('прочитай мою заметку внимательнее', true)).toBe(false);
  });

  it('searches for an analysis request that names the archive', () => {
    // Analysis verbs overlap with search verbs, so a verb-only rule would
    // suppress these — they are the most natural way to ask for a search.
    expect(shouldRunFullSearch('посмотри в моих заметках про Сашу', true)).toBe(true);
    expect(shouldRunFullSearch('прочитай все мои записи про маму', true)).toBe(true);
    expect(shouldRunFullSearch('проанализируй весь дневник целиком', true)).toBe(true);
    // П4 (самопроверка): между предлогом и существительным может стоять
    // определение — «в старых записях», «по прошлым заметкам».
    expect(shouldRunFullSearch('а в старых записях есть что-то про деньги', true)).toBe(true);
    expect(shouldRunFullSearch('разбери по прошлым заметкам', true)).toBe(true);
    // …но указательное слово оставляет ход приложенной заметке.
    expect(shouldRunFullSearch('разбери то, что в этой заметке', true)).toBe(false);
    // S-1 (ревью 2): второй вход в поиск — та же ошибка. Просьба о самой заметке
    // не должна запускать архив ни при каком scope.
    for (const q of [
      'сделай пост по моей записи',
      'что главное в сегодняшней заметке?',
      'что в моей заметке не так?',
      'разбери, что в последней записи',
    ]) {
      expect(shouldRunFullSearch(q, true), q).toBe(false);
    }
  });
});
