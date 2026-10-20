// Приёмка ai-privacy (security-review, Vuln 3): подсказки следующего вопроса шлют
// модели начало последнего ответа. Если ответ цитирует скрытую заметку — по
// локальному номеру, uuid, облачному номеру или номеру с точкой — запрос не
// делается; база не прочиталась — тоже нет. Мутация: всегда false — красный.
import { describe, it, expect } from 'vitest';
import { citesHiddenNote } from '../hiddenNoteIds';

const docs = [
  { id: 'local_1', uuid: 'uuid-1', linkedCloudId: 'cloud-1', excludedFromAI: true },
  { id: '1720194283.716586', excludedFromAI: true },
  { id: 'local_2', uuid: 'uuid-2' },
];
const load = async () => docs;

describe('citesHiddenNote', () => {
  it('скрытая заметка по любому номеру — да', async () => {
    for (const id of ['local_1', 'uuid-1', 'cloud-1', '1720194283.716586']) {
      expect(await citesHiddenNote(`В записи [#${id} · 10 сент.] ты писал: «МАРКЕР»`, load), id).toBe(true);
    }
  });

  it('видимая заметка или без цитат — нет', async () => {
    expect(await citesHiddenNote('Ответ про [#local_2]', load)).toBe(false);
    expect(await citesHiddenNote('Ответ без ссылок', load)).toBe(false);
  });

  it('база не прочиталась — считаем скрытой', async () => {
    expect(await citesHiddenNote('Ответ про [#local_2]', async () => { throw new Error('idb'); })).toBe(true);
  });

  // Тема диалога скрыта — ответ о ней не уходит, даже без ссылки [#id].
  // Мутация: не учитывать topicDocId — красный.
  it('скрытая тема диалога без ссылки в ответе — да', async () => {
    expect(await citesHiddenNote('Ответ без ссылок о той записи', load, 'local_1')).toBe(true);
    expect(await citesHiddenNote('Ответ без ссылок', load, 'local_2')).toBe(false);
  });
});
