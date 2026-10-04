import { describe, it, expect } from 'vitest';
import type { AIDialogue, DialogueMessage } from '../../storage/localDb';
import { headRowPayload, planDialogue, segmentRowPayload } from '../dialogueSegments';
import { parseLocalStoreKey } from '../localStorePages';
import { oldClientWrites, type Row } from './helpers/oldClientRestore029';

// M-5, критерий приёмки №3: формы head и сегмента обязаны быть такими, чтобы
// задепленный в PWA клиент 0.9.28/0.9.29 прошёл мимо них молча. Проверяется НЕ
// пересказом, а тем же портом его read-пути, что и защита M-3
// (helpers/oldClientRestore029.ts).

const ID = 'd-99999999-8888-7777-6666-555555555555';

const dialogue = (messages: DialogueMessage[]): AIDialogue => ({
  id: ID,
  title: 'Большой',
  personaId: 'p',
  personaName: 'P',
  personaEmoji: '🎯',
  createdAt: 1_000,
  updatedAt: 5_000,
  messages,
});

const bigDialogue = (): AIDialogue => dialogue(
  Array.from({ length: 30 }, (_, i) => ({
    id: `m${i}`, role: 'user' as const, content: `k${i}-`.repeat(40_000), createdAt: 1_000 + i,
  })),
);

/** Облачные строки сегментного диалога в ТОЙ форме, которую кладёт выгрузка:
 *  сборщики payload'а общие с write-путём, так что проверка видит реальный код. */
function segmentRows(d: AIDialogue): Row[] {
  const plan = planDialogue(d);
  const rows: Row[] = [{ store: 'aiDialogues', key: ID, payload: headRowPayload(plan.head) }];
  for (const s of plan.segments) {
    rows.push({ store: 'aiDialogues', key: s.key, payload: segmentRowPayload(s) });
  }
  return rows;
}

describe('M-5: формы head и сегмента не читаются старым клиентом', () => {
  // Локальная копия старого клиента МОЛОЖЕ облачной по отметке диалога — иначе
  // затирания не происходит и ловушка была бы пустой проверкой.
  const stale: AIDialogue = {
    ...dialogue([{ id: 'own', role: 'user', content: 'несохранённый ход старого клиента', createdAt: 2_000 }]),
    updatedAt: 2_000,
  };
  const localById = new Map<string, AIDialogue>([[ID, stale]]);

  it('сегментный диалог: старый читатель не пишет ничего', () => {
    const writes = oldClientWrites(segmentRows(bigDialogue()), localById);
    expect(writes).toEqual([]);
  });

  it('ловушка: стоит положить тот же контент в `data` — старый читатель затирает локальный диалог', () => {
    const d = bigDialogue();
    const plan = planDialogue(d);
    // Та же строка head, но с полем data: проверка живая, читатель пишет.
    const trap: Row[] = [{ store: 'aiDialogues', key: ID, payload: { ...plan.head, data: JSON.stringify(d) } }];
    const writes = oldClientWrites(trap, localById);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.dialogue.messages).toHaveLength(d.messages.length);
    // И сегмент с data — второй способ наделать фантомов.
    const segTrap: Row[] = [{ store: 'aiDialogues', key: plan.segments[0]!.key, payload: { data: JSON.stringify(d), updatedAt: d.updatedAt } }];
    expect(oldClientWrites(segTrap, localById).length).toBeGreaterThan(0);
  });

  it('ключ сегмента не является страницей для нашего же парсера', () => {
    const [seg] = planDialogue(bigDialogue()).segments;
    const parsed = parseLocalStoreKey(seg!.key);
    expect(parsed.pageIndex).toBeNull();
    expect(parsed.baseKey).toBe(seg!.key);
  });

  it('ни head, ни сегмент не несут `data`; у сегмента нет и «#» в ключе', () => {
    for (const row of segmentRows(bigDialogue())) {
      expect(row.payload).not.toHaveProperty('data');
      if (row.key !== ID) expect(row.key).not.toContain('#');
    }
  });
});
