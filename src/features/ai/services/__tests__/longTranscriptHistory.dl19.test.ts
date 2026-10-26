// DL-19 / 19.10: разбор длинной расшифровки (~37 тыс. знаков) и второй ход.
// Вопрос: уезжает ли ответ хода 1 в историю и растёт ли вход хода 2 за счёт
// вложения. Собирается НАСТОЯЩИМИ prepareApiMessages и buildContext — как в
// тестах useAIChatNoteTurn и agRag1, без копии логики.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { attachedTurn, formatRefTag } from '../../utils/attachedNoteFormat';
import { API_MSG_CAP, CONTEXT_WINDOW, prepareApiMessages, toApiContent } from '../../utils/aiChatTransport';
import { useAIChatContext } from '../aiChatContext';
import { AIService } from '../AIService';
import { AIProfileService } from '../AIProfileService';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { turnScope } from '../../utils/turnScope';
import { ATTACHED_QUESTION_SEP } from '../../../../shared/ai/languageNudge';

const USER = 'u1';
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: USER }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

// Синтетическая расшифровка: два голоса с таймкодами, ~37 тыс. знаков. Ни строки
// из живого архива — текст сочинён для замера.
function transcript(chars = 37_000): string {
  const voices = ['Клиентка', 'Терапевт'];
  const topics = ['отчёт для завуча', 'группа по субботам', 'звонок сестры', 'депозит по договору', 'письмо из другого города'];
  const lines: string[] = [];
  let produced = 0;
  for (let i = 0; produced < chars; i++) {
    const t = 40 + i * 47;
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    const line = `[00:${mm}:${ss}] ${voices[i % 2]}: Про ${topics[i % topics.length]} я говорила, что посмотрю, и ${'это ' + String(i).padStart(4, '0') + ' '} осталось невысказанным ещё и потому, что ответ не пришёл.`;
    lines.push(line);
    produced += line.length + 1;
  }
  return `Запись сессии, синтетика стенда.\n\n${lines.join('\n')}`;
}

const BODY = transcript();
const NOTE = { documentId: 'local_dl19_note', lastSessionAt: new Date('2026-10-18T12:00:00').getTime(), title: 'Расшифровка сессии 18 октября', content: BODY };
const TURN1 = attachedTurn([NOTE], 'разбери подробно');
const ANSWER1 = `Разбор по порядку. ${'В записи видно, как просьба стоит горло, и ты молчишь два дня. '.repeat(70)}`;
const TURN2 = 'второй пункт — про что именно?';
// Фраза из середины расшифровки: по ней видно, уехало ли тело заметки в историю.
const MIDDLE_PHRASE = (() => {
  const lines = BODY.split('\n').filter(l => l.startsWith('[00:'));
  return lines[Math.floor(lines.length / 2)]!.slice(30, 72);
})();

beforeEach(async () => {
  vi.restoreAllMocks();
  setIndexingConsent(USER, 'granted');
  localStorage.clear();
  const db = await getLocalDb();
  for (const store of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings', 'aiDialogues'] as const) {
    for (const rec of await db.getAll(store)) {
      await db.delete(store, (rec as { id: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId);
    }
  }
  await db.put('documents', {
    id: NOTE.documentId, guestId: USER, title: NOTE.title, currentVersion: 1, totalWords: 6000,
    totalDuration: 0, sessionsCount: 1, firstSessionAt: NOTE.lastSessionAt, lastSessionAt: NOTE.lastSessionAt,
    tags: [], excludedFromAI: false,
  } as never);
  vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue(BODY);
  vi.spyOn(AIProfileService, 'getPortrait').mockResolvedValue(null);
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[0.9, 0.1, 0]], chunks: ['x'], model: 'test', dim: 3 });
});

describe('DL-19 19.10: ход 2 после разбора длинной расшифровки', () => {
  it('приложенный текст длиннее 9 000 знаков — в ход от сборщика тело не кладётся', () => {
    // useAIPageData: `fits = totalChars <= 9000`; для 37 тыс. ход «не влезает» и
    // остаётся шапками. Это первая причина, по которой вход хода 2 не растёт.
    expect(BODY.length).toBeGreaterThan(35_000);
    expect(BODY.length).toBeLessThan(50_000);
    expect(BODY.length).toBeGreaterThan(9_000);
    const headOnly = attachedTurn([{ documentId: NOTE.documentId, title: NOTE.title, lastSessionAt: NOTE.lastSessionAt }], 'разбери подробно');
    expect(headOnly).not.toContain(MIDDLE_PHRASE);
    expect(headOnly.length).toBeLessThan(200);
  });

  it('prepareApiMessages: ответ хода 1 уезжает целиком, тело заметки — нет', () => {
    const api = prepareApiMessages([
      { role: 'user', content: TURN1, type: 'chat' },
      { role: 'assistant', content: ANSWER1, type: 'chat' },
      { role: 'user', content: TURN2, type: 'chat' },
    ]);
    expect(api).toHaveLength(3);
    const u1 = api[0]!, a1 = api[1]!, u2 = api[2]!;
    // 1) ответ хода 1 в messages есть и не обрезан (он последний assistant, и он
    //    короче API_MSG_CAP — ни pruneMessages, ни PROMPT-2-потолок его не трогают)
    expect(a1.content).toBe(ANSWER1);
    expect(a1.content.length).toBeLessThan(API_MSG_CAP);
    // 2) тело расшифровки в историю не идёт: реплика свёрнута в маркеры + вопрос
    expect(u1.content).not.toContain(MIDDLE_PHRASE);
    expect(u1.content).toContain('[Прикреплена заметка: "');
    expect(u1.content).toContain('разбери подробно');
    expect(u2.content).toBe(TURN2);
    // 3) весь вход хода 2 меньше одного тела заметки — рост только за ответа
    const historyChars = api.reduce((s, m) => s + m.content.length, 0);
    expect(historyChars).toBeLessThan(BODY.length);
  });

  it('даже если тело осталось в хранимом ходе (старый клиент), транспорт его вырезает', () => {
    const legacyInline = `${formatRefTag(NOTE)}${ATTACHED_QUESTION_SEP}разбери подробно`;
    const collapsed = toApiContent(legacyInline);
    expect(collapsed).not.toContain(MIDDLE_PHRASE);
    expect(collapsed.length).toBeLessThan(300);
    expect(prepareApiMessages([{ role: 'user', content: legacyInline, type: 'chat' }])[0]!.content).toBe(collapsed);
  });

  it('pruneMessages не при чём: окно 14 сообщений, в диалоге их три', () => {
    const kept = prepareApiMessages([
      { role: 'user', content: TURN1, type: 'chat' },
      { role: 'assistant', content: ANSWER1, type: 'chat' },
      { role: 'user', content: TURN2, type: 'chat' },
    ]);
    expect(CONTEXT_WINDOW).toBeGreaterThan(kept.length);
  });

  it('PROMPT-2: на ходе 4 ответ хода 1 доезжает головой в 1 500 знаков, последние два — целые', () => {
    const api = prepareApiMessages([
      { role: 'user', content: TURN1, type: 'chat' },
      { role: 'assistant', content: ANSWER1, type: 'chat' },
      { role: 'user', content: 'а что в середине?', type: 'chat' },
      { role: 'assistant', content: `Середина. ${ANSWER1}`, type: 'chat' },
      { role: 'user', content: 'продолжи', type: 'chat' },
      { role: 'assistant', content: 'Третий разбор целиком, короткий.', type: 'chat' },
      { role: 'user', content: TURN2, type: 'chat' },
    ]);
    expect(ANSWER1.length).toBeGreaterThan(1_500);
    // старый ответ не выпадает: он остаётся, но срезанным до потолка для прошлых
    // ответов ассистента (1 500 знаков, голова)
    const first = api[1]!.content;
    expect(first.length).toBeLessThanOrEqual(1_500 + 10);
    expect(first.startsWith(ANSWER1.slice(0, 100))).toBe(true);
    // два последних ответа — без потолка
    expect(api[3]!.content).toBe(`Середина. ${ANSWER1}`);
    expect(api[5]!.content).toBe('Третий разбор целиком, короткий.');
  });

  it('buildContext на ходе 2: липкая заметка едет в фенс данных, а не в историю', async () => {
    const { result } = renderHook(() => useAIChatContext('group_psychology'));
    const apiHistory = prepareApiMessages([
      { role: 'user', content: TURN1, type: 'chat' },
      { role: 'assistant', content: ANSWER1, type: 'chat' },
      { role: 'user', content: TURN2, type: 'chat' },
    ]);
    const ctx = await result.current.buildContext({
      text: TURN2,
      scope: turnScope(TURN2),
      attached: { content: formatRefTag(NOTE), documentId: NOTE.documentId, blockIds: [NOTE.documentId] },
      mood: undefined,
      messageHistory: apiHistory,
      isFirstTurn: false,
      dialogueId: 'd-dl19',
      attachedIsSticky: true,
    });
    // заметка-тема остаётся предметом хода: её текст в материалах есть целиком
    expect(ctx.searchContext).toContain(MIDDLE_PHRASE);
    expect(ctx.searchContext!.length).toBeGreaterThan(BODY.length);
    // …и история не выросла до размера вложения
    const historyChars = apiHistory.reduce((s, m) => s + m.content.length, 0);
    expect(historyChars).toBeLessThan(8_000);
    // порог обрезки клиента (A9/FN-2б): 49 000 — у 37-тысячной расшифровки с фоном
    // запаса есть, молчаливая обрезка начала текста не включается
    expect(ctx.searchContext!.length).toBeLessThan(49_000);
  });
});
