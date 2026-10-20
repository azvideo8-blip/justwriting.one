// Приёмка ai-privacy (код-ревью, I-3): цитата скрыта, пока не разрешилась в
// видимую заметку на этом устройстве — помеченную «скрыть», удалённую навсегда и
// заметку с другого устройства (свои локальные номера) старый ответ в историю
// для модели не несёт. Мутация: прежняя семантика «только помеченные» — красный.
import { describe, it, expect } from 'vitest';
import { hiddenNoteIdsFromDocs, ALL_NOTES_HIDDEN } from '../hiddenNoteIds';
import { prepareApiMessages, HIDDEN_ANSWER_PLACEHOLDER } from '../aiChatTransport';

const docs = [
  { id: 'local_vis', uuid: 'uuid-vis' },
  { id: 'local_hid', uuid: 'uuid-hid', excludedFromAI: true },
];

describe('видимая заметка — только доказанно видимая', () => {
  const hidden = hiddenNoteIdsFromDocs(docs);

  it('видимая по локальному номеру и по uuid — не скрыта', () => {
    expect(hidden.has('local_vis')).toBe(false);
    expect(hidden.has('uuid-vis')).toBe(false);
  });

  it('помеченная, удалённая и чужая (номер другого устройства) — скрыты', () => {
    expect(hidden.has('local_hid')).toBe(true);
    expect(hidden.has('doc_deleted_forever')).toBe(true);
    expect(hidden.has('local_from_device_A')).toBe(true);
  });

  it('старый ответ о удалённой заметке уходит модели заглушкой', () => {
    const out = prepareApiMessages([
      { role: 'user', content: 'вопрос' },
      { role: 'assistant', content: 'В записи [#doc_deleted_forever] ты писал: «МАРКЕР»' },
      { role: 'user', content: 'ещё' },
    ], { hiddenCitationIds: hidden });
    expect(out.map(m => m.content).join('\n')).not.toContain('МАРКЕР');
    expect(out[1]?.content).toBe(HIDDEN_ANSWER_PLACEHOLDER);
  });

  it('сбой чтения — скрыто всё', () => {
    expect(ALL_NOTES_HIDDEN.has('local_vis')).toBe(true);
  });
});
