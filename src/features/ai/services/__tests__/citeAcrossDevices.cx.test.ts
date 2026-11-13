// Тикет CX (0.11.13): ответ ИИ написан на компьютере, на телефоне ссылка 📅 не
// открывала заметку. В ссылке стоит местный id (`local_<random>`), у телефона
// он другой и из uuid не выводится. Теперь ответ несёт таблицу `citeRefs`
// (id из ссылки → uuid заметки), она едет слиянием диалога.
// Два «устройства» — одна база по очереди: A пишет ответ, потом заметки
// заменяются копиями B (другой местный id, тот же uuid). Фикстуры синтетические.
// Мутации: resolveCited без поиска по ref → красные «мета» и «клик»;
// убрать citeRefs из replaceLastTurn → красный «перегенерация».
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_cx' }), getCurrentUserId: () => 'u_cx' }));
vi.mock('../../../../core/services/LocalVersionService', () => ({ LocalVersionService: { getLatestContent: async () => 'Текст заметки.' } }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'ru' }) }));
vi.mock('../AIService', () => ({ AIService: { chat: vi.fn(), embed: vi.fn(), extractChatMemory: vi.fn() } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));

const { getLocalDb, resetDbInstance } = await import('../../../../core/storage/localDb');
const { AIDialogueService } = await import('../AIDialogueService');
const { mergeDialogues } = await import('../../../../core/storage/dialogueMerge');
const { useCitationMeta } = await import('../../components/chat/useCitationMeta');
type AIDialogue = import('../../../../core/storage/localDb').AIDialogue;

const U = 'uuid-cx-shared';
const ANSWER = 'Ты писал об этом [#local_cx_A], ещё тут [#local_cx_hidden] и тут [#local_cx_nouuid], а этой нет [#local_cx_gone].';

const note = (id: string, extra: Record<string, unknown>) => ({
  id, guestId: 'u_cx', title: 'Утро', currentVersion: 1, totalWords: 2, totalDuration: 60,
  sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1_700_000_000_000, tags: [], ...extra,
}) as never;

async function deviceA() {
  const db = await getLocalDb();
  await db.put('documents', note('local_cx_A', { uuid: U }));
  await db.put('documents', note('local_cx_hidden', { uuid: 'uuid-cx-hidden', excludedFromAI: true }));
  await db.put('documents', note('local_cx_nouuid', {}));
  return AIDialogueService.create({
    title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    messages: [{ role: 'user', content: 'Привет' }, { role: 'assistant', content: 'Привет!' }],
  });
}

/** Устройство B: тот же диалог до нового хода, та же заметка под своим местным id. */
async function onDeviceB(before: AIDialogue, fromA: AIDialogue, bNote: Record<string, unknown> = {}) {
  const db = await getLocalDb();
  await db.clear('documents');
  await db.put('documents', note('local_cx_B', { uuid: U, ...bNote }));
  return mergeDialogues(before, fromA);
}

const saved = async (id: string) => (await (await getLocalDb()).get('aiDialogues', id))!;

beforeEach(async () => {
  resetDbInstance();
  const db = await getLocalDb();
  await db.clear('documents');
  await db.clear('aiDialogues');
});

describe('CX-1: таблица «ссылка → uuid» при сохранении ответа', () => {
  it('обычный ответ: в таблице только видимая заметка с uuid', async () => {
    const d = await deviceA();
    await AIDialogueService.appendMessage(d.id, 'Что я писал?', ANSWER);
    expect((await saved(d.id)).messages.at(-1)?.citeRefs).toEqual({ local_cx_A: U });
  });

  it('перегенерация: второй путь сохранения пишет таблицу так же', async () => {
    const d = await deviceA();
    await AIDialogueService.replaceLastTurn(d.id, d.messages[0]!.id!, 'Привет', ANSWER);
    const answer = (await saved(d.id)).messages.find(m => m.content === ANSWER);
    expect(answer?.citeRefs).toEqual({ local_cx_A: U });
  });

  it('нет uuid — в таблицу идёт облачный id; ссылка в ходе мыслей тоже считается', async () => {
    const d = await deviceA();
    await (await getLocalDb()).put('documents', note('local_cx_cloud', { linkedCloudId: 'cloud-cx-1' }));
    await AIDialogueService.appendMessage(d.id, 'Вопрос', 'Ответ без ссылок.', 'Смотрю [#local_cx_cloud].');
    expect((await saved(d.id)).messages.at(-1)?.citeRefs).toEqual({ local_cx_cloud: 'cloud-cx-1' });
  });

  it('ответ без ссылок — поля нет', async () => {
    const d = await deviceA();
    await AIDialogueService.appendMessage(d.id, 'Вопрос', 'Просто ответ.');
    expect((await saved(d.id)).messages.at(-1)).not.toHaveProperty('citeRefs');
  });
});

describe('CX-1: два устройства', () => {
  async function answerOnAThenB(bNote: Record<string, unknown> = {}) {
    const before = await deviceA();
    await AIDialogueService.appendMessage(before.id, 'Что я писал?', ANSWER);
    return onDeviceB(before, await saved(before.id), bNote);
  }

  it('на B ссылка [#local_A] получает мету и открывает заметку local_B', async () => {
    const merged = await answerOnAThenB();
    expect(merged.messages.at(-1)?.citeRefs).toEqual({ local_cx_A: U });

    const setPreview = vi.fn();
    const onMissing = vi.fn();
    const { result } = renderHook(() => useCitationMeta(merged.messages, null, setPreview, onMissing));
    // мета: у ссылки появилась дата заметки
    await waitFor(() => expect(result.current.processCitations(ANSWER)).toMatch(/\[📅 [^\]]+\]\(#cite-local_cx_A\)/));
    // клик
    result.current.handleCitationClick('local_cx_A');
    await waitFor(() => expect(setPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'local_cx_B' })));
    expect(onMissing).not.toHaveBeenCalled();
  });

  it('CX-3: ссылка, которой нет в таблице, по-прежнему даёт сообщение', async () => {
    const merged = await answerOnAThenB();
    const setPreview = vi.fn();
    const onMissing = vi.fn();
    const { result } = renderHook(() => useCitationMeta(merged.messages, null, setPreview, onMissing));
    result.current.handleCitationClick('local_cx_gone');
    await waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1));
    expect(setPreview).not.toHaveBeenCalled();
  });

  it.each([
    ['скрыта от ИИ', { excludedFromAI: true }],
    ['в корзине', { trashedAt: 5 }],
  ])('заметка на B %s — по таблице не открывается и меты не получает', async (_name, bNote) => {
    const merged = await answerOnAThenB(bNote);
    const setPreview = vi.fn();
    const onMissing = vi.fn();
    const { result } = renderHook(() => useCitationMeta(merged.messages, null, setPreview, onMissing));
    result.current.handleCitationClick('local_cx_A');
    await waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1));
    expect(setPreview).not.toHaveBeenCalled();
    expect(result.current.processCitations(ANSWER)).toContain('[📅](#cite-local_cx_A)');
  });
});

describe('CX: слияние копий с таблицей', () => {
  const base: AIDialogue = {
    id: 'd', title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯', createdAt: 1000, updatedAt: 2000,
    messages: [{ role: 'user', id: 'u1', content: 'Вопрос', createdAt: 10 }],
  };
  const answer = (extra: Record<string, unknown>) => ({
    ...base,
    messages: [...base.messages, { role: 'assistant' as const, id: 'a1', content: 'Вот [#local_cx_A].', createdAt: 11, turnId: 'u1', ...extra }],
  });

  it('копия без таблицы её не затирает — с любой стороны', () => {
    const withRefs = answer({ citeRefs: { local_cx_A: U }, updatedAt: 100 });
    const without = answer({ updatedAt: 200 });
    expect(mergeDialogues(withRefs, without).messages[1]?.citeRefs).toEqual({ local_cx_A: U });
    expect(mergeDialogues(without, withRefs).messages[1]?.citeRefs).toEqual({ local_cx_A: U });
  });

  it('перегенерация на другом устройстве: таблица старого ответа под новый не переходит', () => {
    const withRefs = answer({ citeRefs: { local_cx_A: U }, updatedAt: 100 });
    const regenerated = answer({ content: 'Другой ответ.', updatedAt: 200 });
    expect(mergeDialogues(withRefs, regenerated).messages[1]?.citeRefs).toBeUndefined();
  });
});
