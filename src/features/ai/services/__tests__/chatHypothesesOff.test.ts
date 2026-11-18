// Флаг chat_hypotheses выключен → ход идёт байт в байт как в 0.11.16.
//
// Эталоны `__golden__/chat-hypotheses-off.*.0-11-16.txt` записаны ЭТИМ ЖЕ тестом на
// дереве 0.11.16 (234fa923) до правок ветки: контекст хода, память, разрешённые
// даты, id заметок и системный промпт целиком. Обновлять их на ветке нельзя —
// тогда тест перестаёт сравнивать с 0.11.16.
//
// Те же эталоны обязаны совпасть и с ВКЛЮЧЁННЫМ флагом там, где гипотезы быть не
// должно: Редактор, кризисный ход, светский ход, вопрос о записях.
//
// Мутации, на которых тест краснеет:
//  - `chatHypothesesEnabled` возвращает true при сбое чтения → красные «сбой RPC» и «сеть упала»;
//  - убрать `if (!uid) return false` → красный «гость»;
//  - убрать проверку характера в `hypothesisTurnOf` → красный «Редактор»;
//  - убрать `crisis` из условия → красный «кризис»;
//  - ставить правило гипотезы в промпт без метки → красные все «флаг выключен»;
//  - звать служебный вызов «найди опоры» до проверки флага → красные все «флаг выключен».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';

const rpc = vi.fn();
const pick = vi.fn(async () => [{ documentId: 'local_clay', quote: 'Сначала надо разобрать антресоль.' }, { documentId: 'local_coffee', quote: 'Остыл.' }]);
let uid: string | undefined = 'u1';
const emptyChain: unknown = new Proxy(() => undefined, {
  get: (_t, prop) => (prop === 'then'
    ? (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
    : () => emptyChain),
});
vi.mock('../../../../core/supabase/client', () => ({ getSupabase: () => ({ rpc, from: () => emptyChain }) }));
vi.mock('../../../../core/auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getCurrentUser: () => (uid ? { uid } : null),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { useAIChatContext } from '../aiChatContext';
import { AIService } from '../AIService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { buildChatSystemPrompt } from '../../../../shared/ai/buildChatPrompt';
import * as syncFlags from '../../../../core/sync/syncFlags';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
const vec = (c: number): number[] => [c, Math.sqrt(Math.max(0, 1 - c * c)), 0];

// Шесть записей выше порога кандидата (0,35) — столько нужно ходу гипотезы, — и одна
// далёкая: с включённым флагом служебный вызов был бы сделан и опоры встали бы в ход.
const ROWS = [
  { id: 'local_far', iso: '2026-01-05', text: 'Про погоду и пробки.', cos: 0.1 },
  { id: 'local_gift', iso: '2026-02-10', text: 'Сертификат лежит в комоде с марта.', cos: 0.4 },
  { id: 'local_child', iso: '2026-03-12', text: 'Бабушка говорила: сначала гаммы, потом двор. Во двор я выходила, когда уже темнело.', cos: 0.46 },
  { id: 'local_coffee', iso: '2026-05-20', text: 'Кофе налила только после почты и посуды. Остыл.', cos: 0.55 },
  { id: 'local_trip', iso: '2026-07-08', text: 'В отпуске два дня закрывала ведомость на балконе.', cos: 0.6 },
  { id: 'local_work', iso: '2026-09-02', text: 'Сдала проект и в тот же день взяла следующий.', cos: 0.7 },
  { id: 'local_clay', iso: '2026-10-30', text: 'Глина так и лежит на балконе. Сначала надо разобрать антресоль.', cos: 0.8 },
] as const;

// Та же близость к реплике (0,55), но в сторону от остальных: с флагом это вторая опора «о другом».
// Лёгкий поиск смотрит только на близость к реплике, эталоны от этого вектора не зависят.
const COFFEE = [0.55, -Math.sqrt(1 - 0.55 * 0.55), 0];

const TURNS = {
  stuck: { persona: 'coach', text: 'опять весь вечер просидела над чертежами, а к глине так и не подошла, и злюсь на себя' },
  why: { persona: 'cbt', text: 'почему я всё время откладываю то, чего мне самой хочется' },
  editor: { persona: 'editor', text: 'опять весь вечер просидела над чертежами, а к глине так и не подошла, и злюсь на себя' },
  // Явный риск, которого нет в заслоне «серой зоны» (он русский и стоит раньше): ход закрывает именно `crisis`.
  crisis: { persona: 'coach', text: 'опять весь вечер просидела над чертежами, к глине не подошла, злюсь на себя ужасно, i want to die' },
  smalltalk: { persona: 'coach', text: 'привет, как дела' },
  archive: { persona: 'coach', text: 'когда я впервые писала про глину?' },
} as const;
type TurnKey = keyof typeof TURNS;

async function turn(key: TurnKey): Promise<string> {
  const { persona, text } = TURNS[key];
  const { result } = renderHook(() => useAIChatContext(persona));
  const ctx = await result.current.buildContext({
    text,
    attached: null,
    mood: undefined,
    messageHistory: [
      { role: 'user', content: 'помоги составить план на неделю' },
      { role: 'assistant', content: 'Давай.' },
      { role: 'user', content: text },
    ] as never,
    isFirstTurn: false,
  });
  const prompt = buildChatSystemPrompt({
    personaId: persona,
    responseLength: 'standard',
    documentContent: ctx.searchContext,
    memoryContext: ctx.memoryContext,
    userPortrait: ctx.userPortrait,
    lastUserMessage: text,
    crisis: ctx.crisis,
    rnd: () => 0,
  });
  return [
    '=== searchContext ===', ctx.searchContext ?? '',
    '=== memoryContext ===', ctx.memoryContext ?? '',
    '=== allowedFirstSeenDates ===', (ctx.allowedFirstSeenDates ?? []).join(','),
    '=== injectedDocumentIds ===', (ctx.injectedDocumentIds ?? []).join(','),
    '=== crisis ===', String(ctx.crisis ?? false),
    '=== system prompt ===', prompt,
  ].join('\n');
}

const golden = (key: TurnKey, guest = false) => `./__golden__/chat-hypotheses-off.${key}${guest ? '-guest' : ''}.0-11-16.txt`;
const flagOn = () => rpc.mockImplementation(async (_fn: string, args?: { flag?: string }) => ({ data: args?.flag === 'chat_hypotheses', error: null }));

describe('chat_hypotheses: ход побайтно как в 0.11.16', () => {
  beforeEach(async () => {
    rpc.mockReset();
    uid = 'u1';
    (syncFlags as { resetSyncFlagsForTests?: () => void }).resetSyncFlagsForTests?.();
    setIndexingConsent('u1', 'granted');
    setIndexingConsent(undefined, 'granted');
    const db = await getLocalDb();
    for (const s of ['documents', 'aiEmbeddings'] as const) await db.clear(s);
    for (const r of ROWS) {
      await db.put('documents', { id: r.id, guestId: 'guest', title: `Заметка ${r.id}`, currentVersion: 1, totalWords: 9, totalDuration: 0, sessionsCount: 1, firstSessionAt: day(r.iso), lastSessionAt: day(r.iso), tags: [] } as never);
    }
    await markAllAnalysed(db);
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(ROWS.map(r => ({
      documentId: r.id, vectors: [r.id === 'local_coffee' ? COFFEE : vec(r.cos)], chunkTexts: [r.text], contentHash: r.id, processedAt: 1, model: 'm', dim: 3,
    })) as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]], chunks: ['q'], model: 'm', dim: 3 } as never);
    // На дереве 0.11.16 служебного вызова «найди опоры» нет; на ветке он обязан молчать во всех случаях ниже.
    pick.mockClear();
    if ('pickAnchors' in AIService) (vi.spyOn as (o: object, k: string) => { mockImplementation(f: unknown): void })(AIService, 'pickAnchors').mockImplementation(pick);
  });

  afterEach(() => { expect(pick).not.toHaveBeenCalled(); });

  describe('флаг выключен', () => {
    for (const key of ['stuck', 'why'] as const) {
      it(`${key}: сервер сказал «нет» (или строки флага нет)`, async () => {
        rpc.mockResolvedValue({ data: false, error: null });
        await expect(await turn(key)).toMatchFileSnapshot(golden(key));
      });
      it(`${key}: сбой RPC (сервер без функции) — старый путь, не «включено»`, async () => {
        rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
        await expect(await turn(key)).toMatchFileSnapshot(golden(key));
      });
      it(`${key}: сеть упала — старый путь`, async () => {
        rpc.mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(await turn(key)).toMatchFileSnapshot(golden(key));
      });
    }

    it('гость (нет uid) — старый путь, сервер о флаге не спрашивается', async () => {
      uid = undefined;
      flagOn();
      await expect(await turn('stuck')).toMatchFileSnapshot(golden('stuck', true));
      expect(rpc).not.toHaveBeenCalledWith('feature_enabled', { flag: 'chat_hypotheses' });
      // У гостя ход до флага не доходит (нет вектора реплики) — флаг проверяется и напрямую.
      const enabled = (syncFlags as { chatHypothesesEnabled?: (uid: string | undefined) => Promise<boolean> }).chatHypothesesEnabled;
      if (enabled) {
        expect(await enabled(undefined)).toBe(false);
        expect(rpc).not.toHaveBeenCalled();
      }
    });
  });

  describe('флаг включён, а гипотезы быть не должно', () => {
    for (const key of ['editor', 'crisis', 'smalltalk', 'archive'] as const) {
      it(`${key}: ход как в 0.11.16`, async () => {
        flagOn();
        await expect(await turn(key)).toMatchFileSnapshot(golden(key));
      });
    }
  });
});
