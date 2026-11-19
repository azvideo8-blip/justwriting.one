// I3 хаос-теста, суженное 19.11 по слову владельца: ошибка — только копия, где
// удалённый текст ожил без правки, которой удаление не видело.
// Мутации: убрать `!hasUnseenEdit` — красный «копия с правкой до появления»;
// убрать `< born` — красный «правка задним числом».
import { describe, expect, it } from 'vitest';
import { stepOfText, unexcusedRevivals } from '../revivalRule';

const base = {
  liveUuids: new Set(['copy']),
  deleted: new Set(['start-7', 'A-7-3']),
  copiesBeforeDeletion: new Map<string, Set<string>>(),
  firstSeen: new Map([['copy', 20]]),
  steps: 60,
};

describe('I3: что считать воскрешением удалённого текста', () => {
  it('копия только из удалённых текстов — ошибка', () => {
    expect(unexcusedRevivals({ ...base, versions: [{ uuid: 'copy', text: 'start-7' }, { uuid: 'copy', text: 'A-7-3' }] })).toEqual(['start-7', 'A-7-3']);
  });
  it('копия с правкой, записанной до её появления (удаление её не видело), — задуманная копия', () => {
    expect(unexcusedRevivals({ ...base, versions: [{ uuid: 'copy', text: 'start-7' }, { uuid: 'copy', text: 'B-7-12' }] })).toEqual([]);
  });
  it('ожившую копию поправили позже — всё равно ошибка', () => {
    expect(unexcusedRevivals({ ...base, versions: [{ uuid: 'copy', text: 'start-7' }, { uuid: 'copy', text: 'B-7-25' }] })).toEqual(['start-7']);
  });
  it('текст до удаления уже жил в этой копии — не воскрешение', () => {
    expect(unexcusedRevivals({ ...base, copiesBeforeDeletion: new Map([['start-7', new Set(['copy'])]]), versions: [{ uuid: 'copy', text: 'start-7' }] })).toEqual([]);
  });
  it('удалённая копия не в счёт', () => {
    expect(unexcusedRevivals({ ...base, liveUuids: new Set(), versions: [{ uuid: 'copy', text: 'start-7' }] })).toEqual([]);
  });
  it('шаг из имени текста', () => {
    expect([stepOfText('start-133'), stepOfText('B-133-18'), stepOfText('что-то')]).toEqual([-1, 18, Infinity]);
  });
});
