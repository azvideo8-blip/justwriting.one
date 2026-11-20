// К28-1: в строгом ходе чужой день под ссылкой на приложенную запись. Синтетика, без вызова модели.
// Мутации: порог слабой ссылки 0,3 → 0,0 (красный: ссылка у выдумки остаётся); порог пары 0,5 → 0,0
// (красный: выдумка получает чужую ссылку).
import { describe, it, expect } from 'vitest';
import { repairStrictNoteRefs } from '../strictRefRepair';

const NOTE = { noteId: 'local_today', noteText: 'Сегодня красил забор в саду и устал, зато закончил всю южную сторону участка.' };
const PRIOR = [
  'Раньше ты находил выход: уходил гулять вечером вдоль реки, и тревога заметно отпускала [#local_august]. Это стоит помнить.',
];

describe('repairStrictNoteRefs', () => {
  it('содержание прошлой записи под ссылкой на приложенную → ссылка прошлой', () => {
    const answer = 'Вечерняя прогулка вдоль реки помогала, тревога заметно отпускала [#local_today]. Сегодня ты красил забор.';
    const out = repairStrictNoteRefs(answer, NOTE, PRIOR);
    expect(out).toContain('отпускала [#local_august].');
    expect(out).not.toContain('[#local_today]');
    expect(out).toContain('Сегодня ты красил забор.');
  });

  it('выдумка без пары в истории → ссылки нет, текст остаётся', () => {
    const answer = 'Ты давно мечтаешь переехать жить далеко отсюда, в тёплые края, где спокойнее [#local_today]. Сегодня ты красил забор.';
    const out = repairStrictNoteRefs(answer, NOTE, PRIOR);
    expect(out).toContain('где спокойнее.');
    expect(out).not.toContain('[#');
    expect(out).toContain('Сегодня ты красил забор.');
  });

  it('верный пересказ приложенной (высокая доля) → без изменений', () => {
    const answer = 'Ты красил забор в саду и закончил всю южную сторону участка [#local_today]. Устал, но доволен.';
    expect(repairStrictNoteRefs(answer, NOTE, PRIOR)).toBe(answer);
  });

  it('короткое предложение (меньше 4 основ) не трогается', () => {
    const answer = 'Так бывает [#local_today].';
    expect(repairStrictNoteRefs(answer, NOTE, PRIOR)).toBe(answer);
  });

  it('ссылки на другие записи в ответе не трогаются', () => {
    const answer = 'Вечерняя прогулка вдоль реки помогала, тревога заметно отпускала [#local_august].';
    expect(repairStrictNoteRefs(answer, NOTE, PRIOR)).toBe(answer);
  });

  it('без ссылки на приложенную — как есть', () => {
    const answer = 'Просто ответ без ссылок на записи вообще.';
    expect(repairStrictNoteRefs(answer, NOTE, PRIOR)).toBe(answer);
  });

  it('прошлая запись скрыта/удалена (вне разрешённых номеров) — чужая ссылка не подставляется, ссылка снимается', () => {
    const answer = 'Вечерняя прогулка вдоль реки помогала, тревога заметно отпускала [#local_today]. Сегодня ты красил забор.';
    const out = repairStrictNoteRefs(answer, NOTE, PRIOR, new Set(['local_today']));
    expect(out).toContain('отпускала.');
    expect(out).not.toContain('[#');
  });

  // Ревью exec-2026-11-20: чистка пробелов перед знаками — только в исправленном предложении.
  it('остальной ответ не переписывается: пробел перед знаком в другом предложении остаётся', () => {
    const answer = 'Ты давно мечтаешь переехать жить далеко отсюда, в тёплые края, где спокойнее [#local_today]. Сегодня ты красил забор :)';
    const out = repairStrictNoteRefs(answer, NOTE, PRIOR);
    expect(out).toContain('где спокойнее.');
    expect(out).toContain('красил забор :)');
  });
});

