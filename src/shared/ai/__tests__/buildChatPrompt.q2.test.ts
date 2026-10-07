import { describe, expect, it } from 'vitest';
import { OPEN_QUESTION_POOL } from '../prompts.js';
import { buildChatSystemPrompt, pickOpenQuestionExamples, type ChatPromptParams } from '../buildChatPrompt.js';

// DLG-Q2: формат, длина, правило ссылок редактора и подборка примеров
// открытых вопросов. Главный ассерт — кэш префикса промпта: случайные примеры
// должны стоять последним ходом статичной части, иначе всё, что после них,
// провайдер пересчитывает каждый ход.
const DOC = 'Результаты поиска по архиву заметок\n[#local_a · 2026-09-01]\nтекст';

// REFLECTION_GUIDE сам отсылает к этой строке, поэтому искать надо по полному
// префиксу, иначе находим ссылку внутри правил, а не сами примеры.
const MARKER = 'ПРИМЕРЫ ОТКРЫТЫХ ВОПРОСОВ (меняются от хода к ходу):';

function build(extra: Partial<ChatPromptParams> = {}): string {
  return buildChatSystemPrompt({
    personaId: 'cbt',
    responseLength: 'standard',
    documentContent: DOC,
    ...extra,
  });
}

/** Строка «ПРИМЕРЫ ОТКРЫТЫХ ВОПРОСОВ …» целиком, либо null если её нет. */
function examplesLine(prompt: string): string | null {
  const at = prompt.indexOf(MARKER);
  if (at < 0) return null;
  return prompt.slice(at, prompt.indexOf('\n', at) < 0 ? prompt.length : prompt.indexOf('\n', at));
}

const items = (line: string | null) => (line ? (line.match(/«[^»]*»/g) ?? []) : []);

describe('Q-2: правила формата и длины', () => {
  it('standard запрещает разделы, а не требует заголовки и списки', () => {
    const p = build();
    expect(p).toContain('без разделов');
    expect(p).not.toContain('заголовков и списков');
  });

  it('short задает длину в знаках', () => {
    expect(build({ responseLength: 'short' })).toContain('до ~500 знаков');
  });

  it('правило редактора — в статичной части, до фенса данных', () => {
    const p = build({ personaId: 'editor' });
    expect(p).toContain('ДЛЯ РЕДАКТОРА:');
    expect(p.indexOf('ДЛЯ РЕДАКТОРА:')).toBeLessThan(p.indexOf('DATA_CONTEXT_BEGIN'));
    expect(build({ personaId: 'cbt' })).not.toContain('ДЛЯ РЕДАКТОРА:');
  });
});

describe('Q-2: примеры открытых вопросов', () => {
  it('при rnd = 0 ровно два примера, детерминированно', () => {
    expect(items(examplesLine(build({ rnd: () => 0 })))).toEqual([OPEN_QUESTION_POOL[0], OPEN_QUESTION_POOL[1]]);
  });

  it('строка стоит после «ДЛИНА ОТВЕТА» и до фенса данных', () => {
    const p = build({ rnd: () => 0 });
    expect(p.indexOf('ДЛИНА ОТВЕТА')).toBeLessThan(p.indexOf(MARKER));
    expect(p.indexOf(MARKER)).toBeLessThan(p.indexOf('DATA_CONTEXT_BEGIN'));
  });

  it('смена подборки не трогает ни байта до строки примеров — кэш префикса жив', () => {
    const a = build({ rnd: () => 0 });
    const b = build({ rnd: () => 0.99 });
    const cut = (s: string) => s.slice(0, s.indexOf(MARKER));
    expect(cut(a)).toBe(cut(b));
    expect(a).not.toBe(b);
    expect(items(examplesLine(a))).toHaveLength(2);
    expect(items(examplesLine(b))).toHaveLength(3);
  });

  it('у редактора и у пользовательской персоны примеров нет', () => {
    expect(examplesLine(build({ personaId: 'editor', rnd: () => 0 }))).toBeNull();
    expect(
      examplesLine(
        buildChatSystemPrompt({
          personaId: 'custom',
          customSystemPrompt: 'говори коротко',
          responseLength: 'standard',
          rnd: () => 0,
        }),
      ),
    ).toBeNull();
  });

  it('pickOpenQuestionExamples: только 2 или 3 разных элемента из пула', () => {
    for (let i = 0; i < 1000; i++) {
      const picked = items(pickOpenQuestionExamples());
      expect(picked.length === 2 || picked.length === 3).toBe(true);
      expect(new Set(picked).size).toBe(picked.length);
      for (const q of picked) expect(OPEN_QUESTION_POOL).toContain(q);
    }
  });
});
