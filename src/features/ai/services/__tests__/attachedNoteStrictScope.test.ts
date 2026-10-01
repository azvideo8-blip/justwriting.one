// Строгий ход по приложенной заметке: в контекст идёт только она. Раньше поиск,
// хронология и память запускались по тексту хода, и модель выдавала цитаты из
// других записей за текст приложенной (разбор «от 29 июля» для заметки от 29 сентября).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIMemoryAssembler } from '../AIMemoryAssembler';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ language: 'ru', t: (k: string) => k }),
}));

const ATTACHED_ID = 'doc_strict_1';
const ATTACHED_CONTENT = 'Текст приложенной заметки про часы и выбор';

async function build(scope: 'note' | 'wide') {
  const { result } = renderHook(() => useAIChatContext('coach'));
  return result.current.buildContext({
    text: 'сравни январь и февраль',
    attached: { documentId: ATTACHED_ID, content: ATTACHED_CONTENT },
    mood: undefined,
    messageHistory: [],
    isFirstTurn: true,
    scope,
  });
}

describe('приложенная заметка: строгий и широкий ход', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const db = await getLocalDb();
    await db.put('documents', { id: ATTACHED_ID, title: 'Аскеза', currentVersion: 1, lastSessionAt: Date.now() } as never);
  });

  it('строгий ход: только заметка — ни сравнения периодов, ни памяти', async () => {
    const assemble = vi.spyOn(AIMemoryAssembler, 'assembleMemoryContext');
    const ctx = await build('note');
    expect(ctx.searchContext).toContain(ATTACHED_CONTENT);
    expect(ctx.searchContext).not.toContain('РЕЖИМ СРАВНЕНИЯ');
    expect(ctx.searchContext).not.toContain('Результаты поиска');
    expect(ctx.memoryContext).toBeNull();
    expect(assemble).not.toHaveBeenCalled();
  });

  it('широкий ход: механизмы контекста работают, как раньше', async () => {
    const ctx = await build('wide');
    expect(ctx.searchContext).toContain(ATTACHED_CONTENT);
    expect(ctx.searchContext).toContain('РЕЖИМ СРАВНЕНИЯ');
  });
});

describe('кризис в приложенной заметке', () => {
  it('строгий ход с вопросом «разбери» всё равно даёт телефоны помощи', async () => {
    const db = await getLocalDb();
    await db.put('documents', { id: 'doc_risk', title: 'Ночь', currentVersion: 1, lastSessionAt: Date.now() } as never);
    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await result.current.buildContext({
      text: 'Разбери эту заметку',
      attached: { documentId: 'doc_risk', content: 'Каждую ночь думаю про суицид.' },
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
      scope: 'note',
    });
    expect(ctx.searchContext).toContain('8-800-333-44-34');
  });
});

describe('R3-001: кризис поднимает флаг для интерфейса', () => {
  it('buildContext отдаёт crisis — useAIChat по нему показывает панель', async () => {
    const db = await getLocalDb();
    await db.put('documents', { id: 'doc_risk2', title: 'Ночь', currentVersion: 1, lastSessionAt: Date.now() } as never);
    const { result } = renderHook(() => useAIChatContext('coach'));
    const base = { mood: undefined, messageHistory: [], isFirstTurn: true };
    const risky = await result.current.buildContext({ ...base, text: 'не хочу жить', attached: null });
    const calm = await result.current.buildContext({ ...base, text: 'как прошёл день', attached: null });
    expect(risky.crisis).toBe(true);
    expect(calm.crisis).toBe(false);
  });
});

describe('R3-004: заметка, скрытая от ИИ, не уходит ни одним каналом', () => {
  const HIDDEN_ID = 'doc_hidden_1';
  const BODY = 'Секретный абзац про сестру';
  // Производственная форма из useAIPageData: шапка `[#id · дата]` + маркер + тело.
  const CONTENT = `[#${HIDDEN_ID} · 2026-09-29]\n[Прикреплена заметка: "Тайна"]\n${BODY}`;

  beforeEach(async () => {
    const db = await getLocalDb();
    await db.put('documents', { id: HIDDEN_ID, title: 'Тайна', currentVersion: 1, lastSessionAt: Date.now(), excludedFromAI: true } as never);
  });

  it.each(['note', 'wide'] as const)('ход %s: тела нет ни в контексте, ни в памяти', async scope => {
    const assemble = vi.spyOn(AIMemoryAssembler, 'assembleMemoryContext');
    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await result.current.buildContext({
      text: 'Разбери эту заметку',
      attached: { documentId: HIDDEN_ID, content: CONTENT },
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
      scope,
    });
    expect(ctx.searchContext ?? '').not.toContain(BODY);
    expect(ctx.memoryContext ?? '').not.toContain(BODY);
    for (const call of assemble.mock.calls) {
      expect(call[0]?.attachedContent ?? null).toBeNull();
    }
  });
});

// S-39 (S-3 leftover): при нескольких заметках в documentId уходит только первая,
// и заметка, скрытая от ИИ уже после прикрепления, доезжала до модели в
// documentContent и в сборщик памяти. Флаг перепроверяется по шапке каждого
// блока в момент отправки.
describe('S-39: скрытая заметка среди нескольких приложенных', () => {
  const OPEN_ID = 'doc_s39_open';
  const HIDDEN_ID = 'doc_s39_hidden';
  const OPEN_BODY = 'Открытый текст про утро';
  const HIDDEN_BODY = 'Секретный абзац, скрытый после прикрепления';
  // Производственная форма из useAIPageData для двух заметок.
  const CONTENT = `[#${OPEN_ID} · 2026-09-29]\n[Прикреплена заметка: "Утро"]\n${OPEN_BODY}\n\n---\n\n[#${HIDDEN_ID} · 2026-09-28]\n[Прикреплена заметка: "Мой "дневник""]\n${HIDDEN_BODY}`;

  beforeEach(async () => {
    const db = await getLocalDb();
    await db.put('documents', { id: OPEN_ID, title: 'Утро', currentVersion: 1, lastSessionAt: Date.now() } as never);
    await db.put('documents', { id: HIDDEN_ID, title: 'Мой "дневник"', currentVersion: 1, lastSessionAt: Date.now(), excludedFromAI: true } as never);
  });

  it.each(['note', 'wide'] as const)('ход %s: тело скрытой вырезано, открытая на месте', async scope => {
    const assemble = vi.spyOn(AIMemoryAssembler, 'assembleMemoryContext');
    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await result.current.buildContext({
      text: 'Разбери эти заметки',
      attached: { documentId: OPEN_ID, content: CONTENT },
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
      scope,
    });
    expect(ctx.searchContext ?? '').toContain(OPEN_BODY);
    expect(ctx.searchContext ?? '').not.toContain(HIDDEN_BODY);
    expect(ctx.searchContext ?? '').toContain('[заметка скрыта от ИИ]');
    expect(ctx.memoryContext ?? '').not.toContain(HIDDEN_BODY);
    for (const call of assemble.mock.calls) {
      expect(call[0]?.attachedContent ?? '').not.toContain(HIDDEN_BODY);
    }
  });
});

describe('R3-005: новый диалог не наследует заметку-тему', () => {
  it('resetSession снимает приложенную заметку', () => {
    const { result } = renderHook(() => useAIChatContext('coach'));
    result.current.setAttachedNote({ content: 'A', documentId: 'doc_a' });
    result.current.resetSession();
    expect(result.current.getAttachedNote()).toBeNull();
  });
});
