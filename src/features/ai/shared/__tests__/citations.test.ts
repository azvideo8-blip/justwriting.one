import { describe, it, expect } from 'vitest';
import { isRecognisedCitation, extractSearchRequest, CITATION_RE } from '../citationPatterns';
import { sanitizeCitations } from '../../hooks/useAIChat';

const INJECTED = ['local_aaa', 'cloudDocId1'];

describe('sanitizeCitations', () => {
  it('keeps a citation of a note that was actually injected', () => {
    const out = sanitizeCitations('Ты писал об этом [#local_aaa].', INJECTED);
    expect(out).toBe('Ты писал об этом [#local_aaa].');
  });

  it('removes a citation of an id that was never injected', () => {
    // The whole point: an id the model invented must not survive. Degrading it
    // to bare text printed the id to the user; keeping it renders a fabricated
    // source as a real, clickable citation.
    const out = sanitizeCitations('Ты писал об этом [#0ad3207b].', INJECTED);
    expect(out).toBe('Ты писал об этом.');
    expect(out).not.toContain('0ad3207b');
  });

  it('removes a bare id the model wrote without the marker', () => {
    const out = sanitizeCitations('Ты писал об этом [0ad3207b].', INJECTED);
    expect(out).toBe('Ты писал об этом.');
  });

  it('removes an unrecognised local_ id too', () => {
    const out = sanitizeCitations('Об этом [#local_d5751490-ffff].', INJECTED);
    expect(out).toBe('Об этом.');
  });

  it('normalises a bare but injected id to the citation form', () => {
    expect(sanitizeCitations('Об этом [local_aaa].', INJECTED)).toBe('Об этом [#local_aaa].');
  });

  it('leaves clean punctuation and spacing behind', () => {
    expect(sanitizeCitations('Раз [#nope] два.', INJECTED)).toBe('Раз два.');
    // A reference list must not keep the separator of the item that went away.
    expect(sanitizeCitations('Источники: [#nope], [#local_aaa].', INJECTED))
      .toBe('Источники: [#local_aaa].');
    expect(sanitizeCitations('Источники: [#local_aaa], [#nope].', INJECTED))
      .toBe('Источники: [#local_aaa].');
    expect(sanitizeCitations('Вопрос [#nope]?', INJECTED)).toBe('Вопрос?');
  });

  it('strips the search marker so it never reaches the screen', () => {
    const out = sanitizeCitations('Не нашёл в контексте.\n[[ПОИСК: про отца]]', INJECTED);
    expect(out).toBe('Не нашёл в контексте.');
  });

  it('does not mangle a citation split across streaming chunks', () => {
    // sanitizeCitations runs on every partial. A half-arrived citation must
    // come out whole once the rest of it lands, not be eaten in pieces.
    const full = 'Ты писал об этом [#local_aaa] вчера.';
    for (let i = 1; i < full.length; i++) {
      const partial = full.slice(0, i);
      const cleaned = sanitizeCitations(partial, INJECTED);
      // Nothing from inside an unfinished citation may leak as bare text.
      expect(cleaned).not.toMatch(/\[#?local_aaa\]\S/);
    }
    expect(sanitizeCitations(full, INJECTED)).toBe(full);
  });
});

describe('isRecognisedCitation', () => {
  it('treats the injected set as the authority while sanitising', () => {
    const injected = new Set(['local_aaa']);
    expect(isRecognisedCitation('[#local_aaa]', 'local_aaa', injected)).toBe(true);
    expect(isRecognisedCitation('[#local_bbb]', 'local_bbb', injected)).toBe(false);
    expect(isRecognisedCitation('[#cloudX]', 'cloudX', injected)).toBe(false);
  });

  it('trusts a surviving marker while rendering, when no set is given', () => {
    expect(isRecognisedCitation('[#anything]', 'anything')).toBe(true);
    expect(isRecognisedCitation('[local_aaa]', 'local_aaa')).toBe(true);
    expect(isRecognisedCitation('[plain]', 'plain')).toBe(false);
  });

  it('never recognises the search marker', () => {
    expect(isRecognisedCitation('[[ПОИСК: про отца]]', 'про отца')).toBe(false);
    expect(isRecognisedCitation('[[поиск: x]]', 'x', new Set(['x']))).toBe(false);
  });
});

describe('extractSearchRequest', () => {
  it('returns the query from a marker at the end of the answer', () => {
    expect(extractSearchRequest('Ответ.\n[[ПОИСК: отношения с отцом]]')).toBe('отношения с отцом');
  });

  it('returns null when there is no marker', () => {
    expect(extractSearchRequest('Обычный ответ без маркера.')).toBeNull();
  });

  it('takes the first marker when the model wrote several', () => {
    expect(extractSearchRequest('[[ПОИСК: первый]] и [[ПОИСК: второй]]')).toBe('первый');
  });

  it('tolerates casing and spacing', () => {
    expect(extractSearchRequest('[[поиск:   про работу  ]]')).toBe('про работу');
  });

  it('is not confused by repeated calls (no leftover lastIndex)', () => {
    const text = '[[ПОИСК: про маму]]';
    expect(extractSearchRequest(text)).toBe('про маму');
    expect(extractSearchRequest(text)).toBe('про маму');
  });
});

describe('CITATION_RE', () => {
  it('matches both conventions and nothing else', () => {
    const text = 'a [#id1] b [id2] c [[ПОИСК: q]] d [не-id] e';
    const found = [...text.matchAll(new RegExp(CITATION_RE.source, CITATION_RE.flags))].map(m => m[0]);
    expect(found).toEqual(['[#id1]', '[id2]', '[[ПОИСК: q]]']);
  });
});

// Imported notes are keyed by their source timestamp, not by local_<uuid>.
describe('ids that are not local_<uuid>', () => {
  const IMPORTED = ['1720194283.716586'];

  it('keeps a citation of an imported note that was injected', () => {
    expect(sanitizeCitations('Ты писал [#1720194283.716586].', IMPORTED))
      .toBe('Ты писал [#1720194283.716586].');
  });

  it('removes one that was not injected instead of printing the id', () => {
    expect(sanitizeCitations('Ты писал [#1720194283.716586].', ['local_aaa']))
      .toBe('Ты писал.');
  });

  it('does not mistake a decimal in brackets for an id', () => {
    // The dot is only allowed in ids long enough to be one, so ordinary
    // notation survives.
    expect(sanitizeCitations('Шкала [1.5] осталась.', ['local_aaa']))
      .toBe('Шкала [1.5] осталась.');
  });
});

describe('search marker placeholders', () => {
  it('ignores the placeholder the prompt used to show', () => {
    // The model copied the example verbatim, and the UI offered to search the
    // archive for the words "краткий запрос".
    expect(extractSearchRequest('Ответ.\n[[ПОИСК: краткий запрос]]')).toBeNull();
    expect(extractSearchRequest('Ответ.\n[[ПОИСК: query]]')).toBeNull();
  });

  it('still returns a real query', () => {
    expect(extractSearchRequest('Ответ.\n[[ПОИСК: отношения с отцом]]')).toBe('отношения с отцом');
  });
});
