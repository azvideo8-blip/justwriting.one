import { describe, expect, it } from 'vitest';
import {
  OPEN_QUESTION_POOL,
  PERSONA_PROMPTS,
  REFLECTION_GUIDE,
  SAFETY_GUIDE,
} from '../prompts.js';
import { CRISIS_RESOURCES_LINE_RU } from '../crisisResources.js';

// DLG-Q1: тексты промптов переехали в версию Fable (v6, редактор — v5). Эти
// ассерты держат именно причины правки, а не дословный текст: дословность
// сторожит снимок SA-9.
describe('Q-1: тексты промптов', () => {
  it('в REFLECTION_GUIDE нет непоставленного плейсхолдера', () => {
    // Примеры вопросов подставляет buildChatSystemPrompt отдельной строкой —
    // иначе рандом в середине статичной части ломает кэш префикса промпта.
    expect(REFLECTION_GUIDE).not.toContain('{{');
    expect(REFLECTION_GUIDE).toContain('ПРИМЕРЫ ОТКРЫТЫХ ВОПРОСОВ');
  });

  it('в пуле примеров нет глаголов прошедшего времени женского рода', () => {
    // Модель копирует формулировки из промпта; корпус Fable целиком женский,
    // а пользователи бывают разные.
    // `\b` вместо `(?![а-яё])` не годится: в JS граница слова считается по
    // ASCII-\w, поэтому внутри кириллицы она не срабатывает никогда.
    const female = OPEN_QUESTION_POOL.filter((q) => /[а-яё]{2,}ла(сь)?(?![а-яё])/i.test(q));
    expect(female).toEqual([]);
    expect(OPEN_QUESTION_POOL.length).toBeGreaterThanOrEqual(12);
  });

  it('SAFETY_GUIDE содержит телефоны целиком', () => {
    // Номера живут только в crisisResources.ts — три копии уже расходились.
    expect(SAFETY_GUIDE).toContain(CRISIS_RESOURCES_LINE_RU);
    // Новая версия различает явный риск и серую зону («не хочу просыпаться»).
    expect(SAFETY_GUIDE).toContain('СЕРАЯ ЗОНА');
  });

  it('редактор описывает формат ответа и дозапрос деталей', () => {
    expect(PERSONA_PROMPTS.editor).toContain('Из заметок:');
    expect(PERSONA_PROMPTS.editor).toContain('— — —');
    // Правило «нет других записей — скажи честно», без него Редактор выдумывает.
    expect(PERSONA_PROMPTS.editor).toContain('ADDING DETAIL');
  });

  it('диалоговые персоны не вернулись к прежним шаблонным пунктам', () => {
    const banned = /Thought Detective|Core Aspiration|Micro-Action/;
    for (const id of ['cbt', 'coach', 'group_psychology'] as const) {
      expect(PERSONA_PROMPTS[id]).not.toMatch(banned);
    }
  });
});
