// Диета 18.11 (замер — justwriting-docs/REPORT-prompt-diet-fable-2026-11.md).
//  1. Строгий ход по одной приложенной заметке собирается без правил о поиске по
//     базе и о светском ходе, а правило хода говорит и о репликах человека.
//  2. Принципы разговора — без шести общих пунктов и дубля о языке.
// Оба — только у собеседников, чьи ходы мерились; Редактор и своя персона прежние.
//
// Мутации, на которых тест краснеет (прогнаны):
//  - `strictDialogue = false` → «строгий ход без правил о поиске», «правило хода о репликах», «кризис в строгом ходе»;
//  - убрать `!strictDialogue &&` у `hasSearch` → «строгий ход без правил о поиске», «кризис в строгом ходе»;
//  - `dieted = true` → «Редактор и своя персона не тронуты»;
//  - `noteScope?.mode === 'note'` заменить на `Boolean(noteScope)` → «широкий ход: правила о поиске на месте»;
//  - «ответ на ход» ставить всегда → «строгий ход без правил о поиске»;
//  - `reflection = REFLECTION_GUIDE` всем → «принципы разговора без семи пунктов»;
//  - вернуть пункт «Конкретика» в короткий текст → «полный и короткий тексты отличаются ровно семью пунктами».
import { describe, expect, it } from 'vitest';
import { buildChatSystemPrompt, noteScopeRule, type ChatPromptParams } from '../buildChatPrompt.js';
import { NOTES_GUARD_BASE, NOTES_GUARD_STRICT, REFLECTION_GUIDE, REFLECTION_GUIDE_NOTE, leanReflectionGuide } from '../prompts.js';

const NOTE = '[Сегодня: среда, 18 ноября 2026 г.]\n\n[#local_n1 · 20261118]\n[Прикреплена заметка: "Суббота"]\nХочу в субботу съездить к маме.';
const turn = (over: Partial<ChatPromptParams>): string => buildChatSystemPrompt({
  personaId: 'coach', responseLength: 'standard', documentContent: NOTE,
  noteScope: { mode: 'note', title: 'Суббота', date: '18 ноября 2026 г.' }, lastUserMessage: 'Разбери эту запись', rnd: () => 0, ...over,
});
const SEARCH_RULES = ['в базе ничего не нашлось', 'Поиск по всей базе заметок', 'ОТВЕТ НА ХОД:', 'в найденных записях этого нет'];
const DROPPED = ['— Со-интерпретация:', '— Конкретика:', '— Эмоциональная подстройка:', '— Агентность пользователя:', '— Привязка к ценностям:', '— АЛЬЯНС И ПОЧИНКА:', '— ЯЗЫК:'];
const MEASURED = ['coach', 'cbt', 'group_psychology', 'parts', 'ta'];

describe('строгий ход: сборка под ход', () => {
  it('строгий ход без правил о поиске', () => {
    for (const personaId of MEASURED) {
      const p = turn({ personaId });
      for (const rule of SEARCH_RULES) expect(p, `${personaId}: ${rule}`).not.toContain(rule);
      expect(p).toContain('«в этой записи этого нет»');
      // Остальные правила о заметках на месте.
      expect(p).toContain('МОДАЛЬНОСТЬ — НЕ ПРЕВРАЩАЙ НАМЕРЕНИЕ В СОБЫТИЕ');
      expect(p).toContain('ПРОИСХОЖДЕНИЕ СКАЗАННОГО РАНЬШЕ');
      expect(p).toContain('БЕЗОПАСНОСТЬ (кризисный протокол)');
    }
  });

  it('правило хода о репликах: сказанное в разговоре — не текст заметки', () => {
    const p = turn({});
    expect(p).toContain('То, что человек говорит в репликах этого разговора, — тоже не текст заметки');
    expect(p).not.toContain('и о том, как с ним говорить');
  });

  it('кризис в строгом ходе — та же сборка, протокол безопасности на месте', () => {
    const p = turn({ crisis: true });
    for (const rule of SEARCH_RULES) expect(p, rule).not.toContain(rule);
    expect(p).toContain('ЭТОТ ХОД — КРИЗИСНЫЙ');
    expect(p).toContain('БЕЗОПАСНОСТЬ (кризисный протокол)');
  });

  it('широкий ход: правила о поиске на месте', () => {
    const p = turn({ noteScope: { mode: 'wide', title: 'Суббота', date: '' } });
    for (const rule of SEARCH_RULES) expect(p, rule).toContain(rule);
  });

  it('ход без приложенной заметки: правила о поиске на месте', () => {
    const p = turn({ noteScope: undefined });
    for (const rule of SEARCH_RULES) expect(p, rule).toContain(rule);
  });

  it('строгий текст правил о заметках отличается от общего только вынутым правилом', () => {
    expect(NOTES_GUARD_STRICT).toBe(NOTES_GUARD_BASE.replace(/ НИКОГДА не говори, что у тебя «нет доступа[^]*?лишь частично\./, ''));
    expect(NOTES_GUARD_STRICT.length).toBeLessThan(NOTES_GUARD_BASE.length);
    expect(leanReflectionGuide(true)).toBe(leanReflectionGuide(false).replace('«в найденных записях этого нет»', '«в этой записи этого нет»'));
  });
});

describe('принципы разговора: короткий текст', () => {
  it('принципы разговора без семи пунктов — у всех мерившихся собеседников, в любом ходе', () => {
    for (const personaId of MEASURED) {
      for (const over of [{}, { noteScope: undefined }, { noteScope: { mode: 'wide' as const, title: 'Суббота', date: '' } }]) {
        const p = turn({ personaId, ...over });
        for (const head of DROPPED) expect(p, `${personaId}: ${head}`).not.toContain(head);
        expect(p).toContain('— ТОЛКОВАНИЕ — ГИПОТЕЗА:');
        expect(p).toContain('— ТЕПЛО + ЧЕСТНО');
        expect(p).toContain('Язык ответа — язык последнего сообщения человека');
      }
    }
  });

  it('полный и короткий тексты отличаются ровно семью пунктами', () => {
    const lean = leanReflectionGuide(false);
    expect(lean).toBe(REFLECTION_GUIDE.split('\n').filter(line => !DROPPED.some(head => line.startsWith(head))).join('\n'));
    expect(REFLECTION_GUIDE.split('\n').length - lean.split('\n').length).toBe(DROPPED.length);
  });

  // Дейлик 20.11 Н-4 (владелец: «чини»): у Редактора и своей персоны в ходе по
  // заметке сняты только правила о поиске, которого не было; остальное — как было
  // (их ходы не мерились). Мутация: notesBase/reflection снова по strictDialogue — красный.
  it('Редактор и своя персона: в ходе по заметке без правил о несостоявшемся поиске, остальное не тронуто', () => {
    for (const over of [{ personaId: 'editor', lastUserMessage: 'Сделай пост' }, { personaId: 'custom', customSystemPrompt: 'Говори просто.' }]) {
      const p = turn(over);
      expect(p, `${over.personaId}`).not.toContain('по этому запросу в базе ничего не нашлось');
      expect(p, `${over.personaId}`).not.toContain('в найденных записях этого нет');
      expect(p).toContain('ОТВЕТ НА ХОД:');
      expect(p).toContain('и о том, как с ним говорить');
      expect(p).toContain(REFLECTION_GUIDE_NOTE);
    }
    expect(noteScopeRule({ mode: 'note', title: 'Т', date: '' })).toContain('и о том, как с ним говорить');
  });
});
