// DI-4: захват подтверждённого вывода — порядок проверок, флаг, фраза, источники,
// служебная строка. Настоящие captureConfirmedInsight / AIChatMemoryService /
// AIDialogueService / confirmationOf поверх fake-indexeddb; подменены край модели
// (pickInsight), флаг сервера и reportError. Мутации — в комментариях у кейсов.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('@/features/ai/services/AIService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/ai/services/AIService')>();
  return { ...actual, AIService: { ...actual.AIService, pickInsight: vi.fn() } };
});
vi.mock('@/core/sync/syncFlags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/sync/syncFlags')>();
  return { ...actual, chatInsightsEnabled: vi.fn() };
});
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { captureConfirmedInsight } from '@/features/ai/services/insightCapture';
import { AIService } from '@/features/ai/services/AIService';
import { chatInsightsEnabled } from '@/core/sync/syncFlags';
import { AIDialogueService } from '@/features/ai/services/AIDialogueService';
import { LocalStoreSyncService } from '@/core/services/LocalStoreSyncService';
import { getLocalDb } from '@/core/storage/localDb';
import { HIDDEN_ANSWER_PLACEHOLDER } from '@/features/ai/utils/aiChatTransport';
import type { HiddenNoteIds } from '@/features/ai/utils/hiddenNoteIds';
import { attachedTurn } from '@/features/ai/utils/attachedNoteFormat';
import { AIChatMemoryService } from '@/features/ai/services/AIChatMemoryService';

const UID = 'u_di4';
const QUOTE = 'Ты ждёшь разрешения на своё, и потому всё откладываешь.';
const REPLY = `${QUOTE} [#doc_1] Похоже на правду?`;
const MARKED_REPLY = 'Если коротко: ты откладываешь своё до последнего. [#doc_1] Хочешь проверить это на неделе?';
const PREV_USER = 'Опять сначала почта, потом посуда, потом ночь.';
const DOCS = [
  { id: 'doc_1', uuid: 'uuid-1' },
  { id: 'doc_hidden', uuid: 'uuid-h', excludedFromAI: true },
];
const HIDDEN: HiddenNoteIds = { has: (id: string) => id === 'doc_hidden', size: 1 };
const t = (key: string, params?: Record<string, string | number>): string =>
  key === 'ai_insight_saved_notice' ? `Сохранено в «Выводы из разговоров»: «${params?.phrase}».` : key;

let dlgId = '';

function input(over: Partial<Parameters<typeof captureConfirmedInsight>[0]> = {}) {
  return {
    uid: UID,
    dialogueId: dlgId,
    personaId: 'coach',
    userText: 'да, похоже',
    prevAssistant: { id: 'msg_prev', content: REPLY },
    prevUser: PREV_USER,
    hiddenCiteIds: HIDDEN,
    parseOpts: { hiddenCitationIds: HIDDEN },
    docs: DOCS,
    t,
    ...over,
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.mocked(chatInsightsEnabled).mockResolvedValue(true);
  vi.mocked(AIService.pickInsight).mockResolvedValue({ ok: true, quote: QUOTE });
  vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});
  localStorage.setItem(`ai_chat_extras_${UID}`, '1');
  const db = await getLocalDb();
  await db.clear('aiChatMemory');
  await db.clear('aiDialogues');
  dlgId = (await AIDialogueService.create({
    title: 'Синтетический разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🧭', messages: [],
  })).id;
});

describe('DI-4: captureConfirmedInsight', () => {
  it('согласие репликой → запись conclusion и служебная строка; повтор — duplicate без второй строки', async () => {
    expect(await captureConfirmedInsight(input())).toBe('saved');
    const db = await getLocalDb();
    const mem = await db.getAll('aiChatMemory');
    expect(mem).toHaveLength(1);
    expect(mem[0]).toMatchObject({
      kind: 'conclusion', text: QUOTE, context: PREV_USER,
      sourceDialogueId: dlgId, sourceMessageId: 'msg_prev',
      sourceDocumentIds: ['uuid-1'], confirmedBy: 'reply',
    });
    expect(mem[0]!.vector).toBeUndefined();
    const dlg = await AIDialogueService.get(dlgId);
    const sys = dlg!.messages.filter(m => m.type === 'system');
    expect(sys).toHaveLength(1);
    expect(sys[0]!.content).toContain(QUOTE);
    // Мутация: пропустить шаг 10 (appendSystemMessage) — красный.
    expect(await captureConfirmedInsight(input())).toBe('duplicate');
    expect(await db.getAll('aiChatMemory')).toHaveLength(1);
    expect((await AIDialogueService.get(dlgId))!.messages.filter(m => m.type === 'system')).toHaveLength(1);
  });

  it('оговорка «да, но…» — не согласие: ни вызова модели, ни записи', async () => {
    expect(await captureConfirmedInsight(input({ userText: 'да, но дело не только в этом' }))).toBe('none');
    expect(AIService.pickInsight).not.toHaveBeenCalled();
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(0);
    // Мутация: убрать шаг 5 (confirmationOf) — красный.
  });

  it('флаг выключен — ход как в 0.11.22; тот же ход с включённым флагом сохраняет', async () => {
    vi.mocked(chatInsightsEnabled).mockResolvedValue(false);
    expect(await captureConfirmedInsight(input())).toBe('none');
    expect(AIService.pickInsight).not.toHaveBeenCalled();
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(0);
    expect((await AIDialogueService.get(dlgId))!.messages.filter(m => m.type === 'system')).toHaveLength(0);
    vi.mocked(chatInsightsEnabled).mockResolvedValue(true);
    expect(await captureConfirmedInsight(input())).toBe('saved');
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(1);
    // Мутация: флаг всегда true — красный (первая половина кейса).
  });

  it('кризисная реплика — вывод не захватывается', async () => {
    expect(await captureConfirmedInsight(input({ userText: 'точно. думал о смерти' }))).toBe('none');
    expect(AIService.pickInsight).not.toHaveBeenCalled();
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(0);
    // Мутация: убрать шаг 3 (detectRisk) — красный.
    // Ревью 0.11.26: согласие с ответом на кризисную реплику. Мутация: не смотреть prevUser — красный.
    expect(await captureConfirmedInsight(input({ prevUser: 'Я хочу умереть' }))).toBe('none');
    expect(AIService.pickInsight).not.toHaveBeenCalled();
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(0);
  });

  it('служебные запросы выключены в настройках — ничего не пишем', async () => {
    localStorage.setItem(`ai_chat_extras_${UID}`, '0');
    expect(await captureConfirmedInsight(input())).toBe('none');
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(0);
    // Мутация: убрать шаг 4 (getChatExtrasEnabled) — красный.
  });

  it('редактор — не персона гипотез, вывод не захватывается', async () => {
    expect(await captureConfirmedInsight(input({ personaId: 'editor' }))).toBe('none');
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(0);
    // Мутация: убрать шаг 2 (HYPOTHESIS_PERSONAS) — красный.
  });

  it('служебная строка, заглушка скрытого ответа и цитата скрытой заметки — не ответ собеседника', async () => {
    expect(await captureConfirmedInsight(input({ prevAssistant: { id: 'm', content: REPLY, type: 'system' } }))).toBe('none');
    expect(await captureConfirmedInsight(input({ prevAssistant: { id: 'm', content: HIDDEN_ANSWER_PLACEHOLDER } }))).toBe('none');
    expect(await captureConfirmedInsight(input({ prevAssistant: { id: 'm', content: 'Вывод о скрытом. [#doc_hidden] Похоже на правду?' } }))).toBe('none');
    expect(AIService.pickInsight).not.toHaveBeenCalled();
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(0);
    // Мутация: убрать шаг 1 — красный.
  });

  it('сбой модели — failed без записи; «вывода нет» — none, реплику человека не сохраняем', async () => {
    vi.mocked(AIService.pickInsight).mockResolvedValue({ ok: false, error: 'AI_UNAVAILABLE' });
    expect(await captureConfirmedInsight(input())).toBe('failed');
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(0);
    expect((await AIDialogueService.get(dlgId))!.messages.filter(m => m.type === 'system')).toHaveLength(0);
    vi.mocked(AIService.pickInsight).mockResolvedValue({ ok: true, quote: null });
    expect(await captureConfirmedInsight(input())).toBe('none');
    expect(await (await getLocalDb()).getAll('aiChatMemory')).toHaveLength(0);
    // Мутация: при quote:null сохранять userText как вывод — красный.
  });

  it('абзац «Если коротко:» — фраза кодом, модель не вызывается', async () => {
    expect(await captureConfirmedInsight(input({ prevAssistant: { id: 'msg_prev', content: MARKED_REPLY } }))).toBe('saved');
    expect(AIService.pickInsight).not.toHaveBeenCalled();
    const mem = await (await getLocalDb()).getAll('aiChatMemory');
    expect(mem[0]!.text).toBe('ты откладываешь своё до последнего.');
    // Мутация: всегда вызывать pickInsight — красный.
  });

  // Ревью 0.11.24, I-1: реплика с приложенной заметкой несёт её тело. Ни модели,
  // ни в память оно не идёт (как в истории хода — toApiContent), а сама заметка
  // становится источником: скрыть её позже = вывод больше не вспоминается.
  // Мутации: prevUserApi → prevUser (тело в pickInsight и context) — красный;
  // insightSources без prevUser — источника doc_att нет, красный.
  it('реплика с приложенной заметкой: без тела модели и в память, заметка — источник', async () => {
    const BODY = 'Синтетическое тело заметки про длинный вечер и почту.';
    const prevUser = attachedTurn([{ documentId: 'doc_att', title: 'Вечер', content: BODY, lastSessionAt: 0 }], 'почему я откладываю?');
    const docs = [...DOCS, { id: 'doc_att', uuid: 'uuid-att' }];
    const res = await captureConfirmedInsight(input({ prevUser, docs }));
    expect(res).toBe('saved');
    const [userArg] = vi.mocked(AIService.pickInsight).mock.calls[0]!;
    expect(userArg).not.toContain(BODY);
    expect(userArg).toContain('почему я откладываю?');
    const saved = (await AIChatMemoryService.getAll()).find(m => m.text === QUOTE);
    expect(saved?.context ?? '').not.toContain(BODY);
    expect(saved?.sourceDocumentIds).toEqual(expect.arrayContaining(['uuid-1', 'uuid-att']));
  });

  // I-2 (зеркало для захвата): реплика со скрытой приложенной заметкой — не место для вывода.
  // Мутация: убрать citesAnyId(prevUser, …) — pickInsight зовётся, красный.
  it('реплика со скрытой приложенной заметкой — ничего, модель не зовётся', async () => {
    const prevUser = attachedTurn([{ documentId: 'doc_hidden', title: 'Скрытая', content: 'тело', lastSessionAt: 0 }], 'а это?');
    vi.mocked(AIService.pickInsight).mockClear();
    expect(await captureConfirmedInsight(input({ prevUser, prevAssistant: { id: 'm', content: `${QUOTE} Похоже?` } }))).toBe('none');
    expect(AIService.pickInsight).not.toHaveBeenCalled();
  });
});
