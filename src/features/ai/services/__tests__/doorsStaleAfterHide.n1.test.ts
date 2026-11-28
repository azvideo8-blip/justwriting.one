// Дейлик 28.11 (Н-1): «Наблюдение» (Contact Doors) кэшировалось на весь диалог —
// заметку скрыли от ИИ посреди разговора, а вывод по ней уходил модели каждым ходом.
// Настоящий хук и aiChatContext над IndexedDB; подменён край (сеть, согласие, флаги).
// Мутация: снять перечитку заметок кэша перед ходом — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';

const h = vi.hoisted(() => ({ uid: 'u-n1' }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/supabase/client', () => ({ getSupabase: () => { throw new Error('сети в тесте нет'); } }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));
vi.mock('../../../../core/auth', async importActual => ({ ...(await importActual<object>()), getCurrentUser: () => ({ uid: h.uid }) }));
vi.mock('../../../../core/ai/indexingConsent', async importActual => ({ ...(await importActual<object>()), hasIndexingConsent: () => false }));
vi.mock('../../../../core/sync/syncFlags', () => ({
  answerChronicleV2Enabled: async () => false, chatInsightsEnabled: async () => false, chatHypothesesEnabled: async () => false,
}));

import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { setEncryptionEnabled, setProfileLoaded } from '../../../../core/crypto/cryptoHelpers';
import { doorLabel } from '../../utils/contactDoors';

// A — поступки (много «отложил, бросил, не начал…»), B — мысли. Синтетика.
const TEXT_A = 'Опять отложил звонок, бросил уборку, не начал отчёт, проспал, опоздал, пропустил встречу, забросил план, сорвал срок, перенёс разговор, отменил поездку, сбежал с вечера.';
const TEXT_B = 'Думаю о работе, размышляю, считаю, что понимаю причину; вывод такой: значит, надо проверить гипотезу.';

const doc = (id: string, n: number, over: object = {}) => ({
  id, guestId: h.uid, title: id, currentVersion: 1, totalWords: 20, totalDuration: 0, sessionsCount: 1,
  firstSessionAt: n, lastSessionAt: n, tags: [], ...over,
});

beforeEach(async () => {
  setProfileLoaded(h.uid, true);
  setEncryptionEnabled(h.uid, false);
  const db = await getLocalDb();
  for (const s of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings'] as const) await db.clear(s);
  for (const [id, text, n] of [['A', TEXT_A, 2], ['B', TEXT_B, 1]] as const) {
    await db.put('documents', doc(id, n) as never);
    await db.put('versions', { id: `v${id}`, documentId: id, guestId: h.uid, version: 1, content: text, wordCount: 20, duration: 1, wpm: 1, savedAt: n, sessionStartedAt: n } as never);
    await db.put('aiSummaries', { documentId: id, summary: 's', tone: '', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: 1 } as never);
  }
});

const turn = (ctx: ReturnType<typeof useAIChatContext>, text: string) => ctx.buildContext({
  text, attached: null, mood: undefined, messageHistory: [], isFirstTurn: false, scope: 'wide',
} as never);

describe('Н-1: «Наблюдение» перечитывает заметки перед каждым ходом', () => {
  it('A скрыли между ходами — вывод по ней пропадает из следующего хода', async () => {
    const { result } = renderHook(() => useAIChatContext('cbt'));
    const first = await turn(result.current, 'Как у меня дела с делами?');
    expect(first.searchContext ?? '').toContain(`опирается на ${doorLabel('behavior')}`);

    const db = await getLocalDb();
    await db.put('documents', { ...(await db.get('documents', 'A'))!, excludedFromAI: true } as never);

    const second = await turn(result.current, 'А ещё что заметно?');
    expect(second.searchContext ?? '').not.toContain(`опирается на ${doorLabel('behavior')}`);
  });

  it('ничего не меняли — второй ход берёт тот же вывод (кэш жив)', async () => {
    const { result } = renderHook(() => useAIChatContext('cbt'));
    const first = await turn(result.current, 'Как у меня дела с делами?');
    const second = await turn(result.current, 'А ещё что заметно?');
    expect(second.searchContext ?? '').toContain(`опирается на ${doorLabel('behavior')}`);
    expect(first.searchContext).toBeTruthy();
  });
});

// Тот же класс (кэш на разговор): портрет. Уборка после скрытия заметки вычистила
// портрет — следующий ход не должен слать старый. Мутация: вернуть кэш портрета — красный.
describe('Н-1 (класс): портрет читается на каждом ходе', () => {
  it('портрет убрали посреди разговора — следующий ход его не шлёт', async () => {
    const db = await getLocalDb();
    await db.put('aiPortrait', { id: 'singleton', portrait: 'MARKER_PORTRAIT_N1 синтетический портрет', updatedAt: 1 } as never);
    const { result } = renderHook(() => useAIChatContext('cbt'));
    const first = await turn(result.current, 'Как у меня дела?');
    expect(JSON.stringify(first)).toContain('MARKER_PORTRAIT_N1');

    // Уборка портрета (noteDerivativePurge): запись в базе и её копия в localStorage.
    await db.delete('aiPortrait', 'singleton');
    for (const k of Object.keys(localStorage)) if (k.startsWith('ai_user_portrait')) localStorage.removeItem(k);
    const second = await turn(result.current, 'А ещё?');
    expect(JSON.stringify(second)).not.toContain('MARKER_PORTRAIT_N1');
  });
});
