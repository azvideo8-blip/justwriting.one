import { describe, it, expect } from 'vitest';
import { dialogueCitesHidden, dialogueFacetVisible } from '../dialogueFacetVisibility';
import { hiddenNoteIdsFromDocs, ALL_NOTES_HIDDEN, type HiddenNoteIds } from '../hiddenNoteIds';
import { extractCitationIds } from '../../services/chatContext/citations';
import type { AIDialogue } from '../../../../core/storage/localDb';

// Хвост плана 27.10 (§7): `proactive.ts` держал третью формулировку правила
// видимости диалога (`citesHidden`). Свели к `dialogueCitesHidden`, общей с
// гранями. Поведение proactive не меняется: ниже его прежняя формулировка
// дословно, и на всей матрице ответ совпадает.
// Мутации: убрать проверку `documentId` или проверку реплик в
// `dialogueCitesHidden` — красный.

function proactiveBefore(d: AIDialogue, hiddenIds: HiddenNoteIds): boolean {
  return (!!d.documentId && hiddenIds.has(d.documentId))
    || d.messages.some(m => extractCitationIds(m.content).some(id => hiddenIds.has(id)));
}

const doc = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });
const DOCS = [
  doc('vis', { uuid: 'vis-uuid' }),
  doc('hid', { excludedFromAI: true }),
  doc('trash', { trashedAt: 1 }),
];

const TOPICS = [undefined, 'vis', 'vis-uuid', 'hid', 'trash', 'gone'];
const TEXTS = [
  'без ссылок',
  'см. [#vis]',
  'см. [#vis-uuid · 20261001]',
  'см. [#hid]',
  'см. [#gone · 20261001]',
  'две: [#vis] и [#trash]',
  '[#1720194283.716586]',
];

function dialogue(documentId: string | undefined, texts: string[], extra: Partial<AIDialogue> = {}): AIDialogue {
  return {
    id: 'd1', personaId: 'coach', createdAt: 0, updatedAt: 0,
    ...(documentId !== undefined ? { documentId } : {}),
    messages: texts.map((content, i) => ({ role: i % 2 ? 'assistant' : 'user', content, timestamp: i })),
    ...extra,
  } as AIDialogue;
}

describe('dialogueCitesHidden = прежний citesHidden из proactive', () => {
  const sets: [string, HiddenNoteIds][] = [
    ['по документам', hiddenNoteIdsFromDocs(DOCS)],
    ['сбой чтения (всё скрыто)', ALL_NOTES_HIDDEN],
  ];
  for (const [name, hiddenIds] of sets) {
    it(`матрица тема × реплики совпадает: ${name}`, () => {
      let hits = 0;
      for (const topic of TOPICS) {
        for (const a of TEXTS) {
          for (const b of [[], ['без ссылок'], [a, 'ответ [#vis]']] as string[][]) {
            const d = dialogue(topic, [a, ...b]);
            const want = proactiveBefore(d, hiddenIds);
            if (want) hits++;
            expect(dialogueCitesHidden(d, hiddenIds), `${topic ?? '-'} | ${a} | ${b.join(' / ')}`).toBe(want);
          }
        }
      }
      // Контроль: матрица не вырождена — есть и «скрыто», и «видно».
      expect(hits).toBeGreaterThan(0);
      expect(hits).toBeLessThan(TOPICS.length * TEXTS.length * 3);
    });
  }

  it('грани: прежнее поведение dialogueFacetVisible (нет/удалён → невидим)', () => {
    const hiddenIds = hiddenNoteIdsFromDocs(DOCS);
    expect(dialogueFacetVisible(undefined, hiddenIds)).toBe(false);
    expect(dialogueFacetVisible(dialogue('vis', ['см. [#vis]'], { deletedAt: 1 } as Partial<AIDialogue>), hiddenIds)).toBe(false);
    expect(dialogueFacetVisible(dialogue('vis', ['см. [#vis]']), hiddenIds)).toBe(true);
    expect(dialogueFacetVisible(dialogue('hid', ['см. [#vis]']), hiddenIds)).toBe(false);
    expect(dialogueFacetVisible(dialogue('vis', ['см. [#hid]']), hiddenIds)).toBe(false);
  });
});
