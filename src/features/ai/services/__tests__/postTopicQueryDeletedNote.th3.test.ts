import { describe, it, expect } from 'vitest';
import { postTopicQuery } from '../aiChatContext';

// TH-3, aiChatContext (дейлик 27.10, тезис 3): «тема последнего ответа
// Редактора» не берётся, если ответ цитирует скрытую или корзинную заметку.
// Заметки, которой на устройстве уже нет (удалена), этот страж пропускал:
// `doc` не найден — и тело ответа с её строками уходило в запрос поиска и в
// эмбеддинг. Правило соседних проверок — «нет заметки» = «нельзя» (S-51).
//
// Маркеры выдуманные, живых формулировок здесь нет.

const DELETED_ID = 'doc_gone_posttopic_th3';
const VISIBLE_ID = 'doc_visible_posttopic_th3';
const BODY_MARKER = 'ТЕЛО-ОТВЕТА-TH3';

const reply = (id: string) => [
  { role: 'user', content: 'что там было?' },
  { role: 'assistant', content: `${BODY_MARKER} [#${id}]` },
];

const docById = async (id: string) =>
  id === VISIBLE_ID
    ? ({ id, title: 'видимая', currentVersion: 1 } as never)
    : undefined;

describe('TH-3: ответ со ссылкой на удалённую заметку не становится запросом', () => {
  it('цитата заметки, которой нет на устройстве, отменяет тело', async () => {
    expect(await postTopicQuery(reply(DELETED_ID), docById)).toBeUndefined();
  });

  it('контроль: ответ о видимой заметке по-прежнему даёт запрос', async () => {
    const body = await postTopicQuery(reply(VISIBLE_ID), docById);
    expect(body).toContain(BODY_MARKER);
  });
});
