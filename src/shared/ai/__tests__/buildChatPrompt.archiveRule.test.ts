import { describe, expect, it } from 'vitest';
import { buildChatSystemPrompt, type ChatPromptParams } from '../buildChatPrompt.js';
import { ARCHIVE_ANSWER_RULE, ARCHIVE_TURN_MARK } from '../archiveAnswerRule.js';

// Правило ответа на вопрос о записях (флаг answer_chronicle_v2). Метку ставит
// клиент в блок записей; сервер по ней добавляет правило ВНЕ ограды данных.
//
// Мутации, на которых тесты краснеют:
//  - убрать проверку `documentContent.includes(ARCHIVE_TURN_MARK)` → «без метки промпт прежний»;
//  - поставить правило до `noteFence` → «правило стоит после всех оград данных»;
//  - убрать `personaId !== 'editor'` → «редактор правило не получает»;
//  - убрать `crisis !== true` → «кризисный ход правило не получает».
const NOTES = '[Возможно релевантные заметки]\n[#local_a · 2026-09-01]\nЗаметка 1: "Коплю"\nтекст';

const build = (extra: Partial<ChatPromptParams> = {}): string => buildChatSystemPrompt({
  personaId: 'coach', responseLength: 'detailed', documentContent: `${ARCHIVE_TURN_MARK}\n\n${NOTES}`, rnd: () => 0, ...extra,
});

describe('правило ответа на вопрос о записях', () => {
  it('без метки промпт прежний: правила нет', () => {
    const p = build({ documentContent: NOTES });
    expect(p).not.toContain('ЭТОТ ХОД — ВОПРОС О ЗАПИСЯХ');
    expect(p.endsWith('DATA_CONTEXT_END')).toBe(true);
  });

  it('с меткой правило стоит после всех оград данных, последним', () => {
    const p = build({ memoryContext: 'память', userPortrait: 'портрет' });
    expect(p.endsWith(ARCHIVE_ANSWER_RULE)).toBe(true);
    expect(p.lastIndexOf('DATA_CONTEXT_END')).toBeLessThan(p.indexOf(ARCHIVE_ANSWER_RULE));
    // всё до правила — тот же промпт, что без него
    const without = build({ memoryContext: 'память', userPortrait: 'портрет', personaId: 'editor' });
    expect(without).not.toContain(ARCHIVE_ANSWER_RULE);
  });

  it('метка меняет промпт ровно на правило в конце', () => {
    const doc = `${ARCHIVE_TURN_MARK}\n\n${NOTES}`;
    const p = build({ documentContent: doc });
    const crisis = build({ documentContent: doc, crisis: true });
    expect(p).toBe(`${p.slice(0, p.length - ARCHIVE_ANSWER_RULE.length - '\n\n---\n'.length)}\n\n---\n${ARCHIVE_ANSWER_RULE}`);
    expect(crisis).not.toContain(ARCHIVE_ANSWER_RULE);
  });

  it('редактор и строгий ход по заметке правило не получают', () => {
    expect(build({ personaId: 'editor' })).not.toContain(ARCHIVE_ANSWER_RULE);
    expect(build({ noteScope: { mode: 'note', title: 'Коплю' } as never })).not.toContain(ARCHIVE_ANSWER_RULE);
  });

  it('в правиле нет образцов дат и цитат, которые модель перенесла бы в ответ', () => {
    // цифры в правиле — только потолки длины; образца даты (день + месяц, ГГГГ-ММ) нет
    expect(ARCHIVE_ANSWER_RULE).not.toMatch(/(19|20)\d\d|\d{1,2}\s+(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/);
    expect(ARCHIVE_ANSWER_RULE).not.toMatch(/«[^»]{20,}»/);
  });
});
