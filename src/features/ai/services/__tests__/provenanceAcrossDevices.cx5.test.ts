// CX-5 (0.11.13): «откуда ты это взял?» на устройстве B после ответа, написанного
// на A. В contextDocIds прошлого ответа — местные id A; B их не знает, и ход
// поднимал пустые материалы. Теперь useAIChat переводит их в id B по citeRefs
// ответа (localDocIds), а сборщик хода работает как на A.
// Мутации: localDocIds без поиска по refs → красные (a) и (c); без пропуска
// корзины → красный (b). Фикстуры синтетические.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIService } from '../../services/AIService';
import { localDocIds } from '../../utils/canonicalDocumentId';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

const UF = 'uuid-cx5-found';
const FOUND_B = 'local_cx5_found_B';
const FOUND_TEXT = 'Разговор с сестрой: снова беру чужие сроки на себя.';
const doc = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });

describe('CX-5: localDocIds', () => {
  const docs = [doc('local_own'), doc(FOUND_B, { uuid: UF }), doc('local_cloud_B', { linkedCloudId: 'cloud-1' })];

  it('(a) чужой id → свой по таблице (uuid и облачный id); свой id — как есть', () => {
    expect(localDocIds(['local_own', 'local_found_A', 'local_cloud_A'], { local_found_A: UF, local_cloud_A: 'cloud-1' }, docs))
      .toEqual(['local_own', FOUND_B, 'local_cloud_B']);
  });

  it('(b) копия в корзине не подставляется; нет в таблице — id как был', () => {
    const trashed = [doc(FOUND_B, { uuid: UF, trashedAt: 5 })];
    expect(localDocIds(['local_found_A', 'local_x'], { local_found_A: UF }, trashed)).toEqual(['local_found_A', 'local_x']);
  });

  it('нет id — undefined, как раньше', () => {
    expect(localDocIds(undefined, { a: UF }, docs)).toBeUndefined();
  });
});

describe('CX-5: ход «откуда ты это взял?» на B', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const db = await getLocalDb();
    await db.clear('documents');
    const now = Date.now();
    await db.put('documents', {
      id: FOUND_B, uuid: UF, guestId: 'u1', title: 'Разговор с сестрой', currentVersion: 1, totalWords: 9,
      totalDuration: 60, sessionsCount: 1, firstSessionAt: now, lastSessionAt: now, tags: [],
    } as never);
    await markAllAnalysed(db);
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => (id === FOUND_B ? FOUND_TEXT : ''));
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]] } as never);
  });

  it('(c) материалы прошлого ответа с A поднимаются под id B', async () => {
    const docs = await (await getLocalDb()).getAll('documents');
    const prevTurnDocIds = localDocIds(['local_cx5_found_A'], { local_cx5_found_A: UF }, docs);
    const { result } = renderHook(() => useAIChatContext('reflection'));
    const history = [
      { role: 'user' as const, content: 'что у меня было с сестрой?' },
      { role: 'assistant' as const, content: 'Ты писал, что берёшь чужие сроки [#local_cx5_found_A].' },
      { role: 'user' as const, content: 'откуда ты это взял?' },
    ];
    const ctx = await result.current.buildContext({
      text: 'откуда ты это взял?', mood: undefined, messageHistory: history, isFirstTurn: false, scope: 'wide', prevTurnDocIds,
    } as never);
    expect(ctx.searchContext).toContain(`[#${FOUND_B}`);
    expect(ctx.searchContext).toContain('чужие сроки');
  });
});
