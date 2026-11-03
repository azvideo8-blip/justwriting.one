import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { computeLocalEcho } from '../WritingFinishModal';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: vi.fn(() => null) }));

// Хвост плана 27.10 (§7): «Связь мыслей» в окне «Записано.» брала тему из всей
// хронологии ИИ — в том числе у заметки, скрытой от ИИ. В модель она не шла, но
// на экран попадала. Ближайшая по смыслу здесь — скрытая; видимая — запасная.
// Мутация: убрать `visible.has(...)` из фильтра истории — красный.
//
// Маркеры выдуманные, живых формулировок здесь нет.

const CUR = 'doc_cur_echo';
const VIS = 'doc_vis_echo';
const HID = 'doc_hid_echo';
const THEME_VIS = 'тема-видимой-echo';
const THEME_HID = 'тема-скрытой-echo';

function doc(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, guestId: 'guest', title: id, currentVersion: 1, totalWords: 10, totalDuration: 100,
    sessionsCount: 1, firstSessionAt: Date.now(), lastSessionAt: Date.now(), tags: [], ...extra,
  } as never;
}

describe('«Записано.»: связь мыслей не называет тему скрытой заметки', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    for (const store of ['documents', 'aiEmbeddings', 'aiTimeline'] as const) await db.clear(store);
    await db.put('documents', doc(CUR));
    await db.put('documents', doc(VIS));
    await db.put('aiEmbeddings', { documentId: CUR, vectors: [[1, 0]] } as never);
    await db.put('aiEmbeddings', { documentId: HID, vectors: [[1, 0]] } as never);
    await db.put('aiEmbeddings', { documentId: VIS, vectors: [[0.8, 0.6]] } as never);
    await db.put('aiTimeline', { documentId: HID, date: '2026-10-01', month: '2026-10', themes: [THEME_HID] } as never);
    await db.put('aiTimeline', { documentId: VIS, date: '2026-10-02', month: '2026-10', themes: [THEME_VIS] } as never);
  });

  for (const [why, hidden] of [
    ['скрыта от ИИ', doc(HID, { excludedFromAI: true })],
    ['в корзине', doc(HID, { trashedAt: Date.now() })],
    ['заметки нет на устройстве', null],
  ] as const) {
    it(`ближайшая ${why} — берётся видимая`, async () => {
      const db = await getLocalDb();
      if (hidden !== null) await db.put('documents', hidden);
      const echo = await computeLocalEcho('', CUR);
      expect(echo).not.toContain(THEME_HID);
      expect(echo, 'контроль: видимая связь показана').toContain(THEME_VIS);
    });
  }

  it('контроль: та же заметка видима — побеждает она', async () => {
    const db = await getLocalDb();
    await db.put('documents', doc(HID));
    expect(await computeLocalEcho('', CUR)).toContain(THEME_HID);
  });
});
