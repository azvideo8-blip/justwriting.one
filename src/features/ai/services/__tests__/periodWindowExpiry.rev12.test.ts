// Ревью 0.10.12 (M-2): окно перечня (PR-3) жило до конца диалога. Через десять
// ходов «я каждую ночь просыпаюсь в 4 утра — почему?» или «расскажи по порядку…»
// совпадали со словами продолжения, и ответ искал только в старом окне, с
// перечнем его записей впридачу. Окно — только на ход сразу после перечня
// (или после продолжения) и не в ход с приложенной заметкой.
//
// Мутация: не сбрасывать окно на ходе без перечня/продолжения → (1) красный;
// отдавать окно ходу с вложением → (2) красный.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIService } from '../../services/AIService';
import * as noteRetriever from '../../utils/noteRetriever';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

const DAY = 86_400_000;
const OCT_1 = Date.UTC(2026, 9, 1);
const CARRIED = '[Записи периода, о котором шла речь]';

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings', 'versions'] as const) await db.clear(store);
  for (const n of [{ id: 'local_r12_a', at: OCT_1 + 2 * DAY, mark: 'А' }, { id: 'local_r12_b', at: OCT_1 + 11 * DAY, mark: 'Б' }]) {
    await db.put('documents', {
      id: n.id, guestId: 'u1', title: `Запись ${n.mark}`, currentVersion: 1,
      totalWords: 30, totalDuration: 60, sessionsCount: 1,
      firstSessionAt: n.at, lastSessionAt: n.at, tags: [],
    } as never);
    await db.put('aiSummaries', {
      documentId: n.id, processedAt: n.at, summary: `СУТЬ_${n.mark}`, themes: [],
      insights: [`ОЗАРЕНИЕ_${n.mark}`], extractedFacts: [],
    } as never);
  }
  vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue('Тело записи');
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]] } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
  vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({ notes: [], failed: false, degraded: false } as never);
}

type Build = (p: Record<string, unknown>) => Promise<{ searchContext?: string }>;
const FIRST = 'перечисли все мои осознания за октябрь 2026';

async function ask(build: Build, text: string, extra: Record<string, unknown> = {}): Promise<string> {
  const ctx = await build({
    text, attached: undefined, mood: undefined, messageHistory: [{ role: 'user', content: text }],
    isFirstTurn: false, scope: 'wide', ...extra,
  });
  return ctx.searchContext ?? '';
}

function freshBuild(): Build {
  const { result } = renderHook(() => useAIChatContext('coach'));
  return result.current.buildContext as unknown as Build;
}

describe('ревью 0.10.12: окно перечня — только на следующий ход', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('(1) после хода на другую тему «каждую ночь» окно не тянет', async () => {
    await seed();
    const build = freshBuild();
    await ask(build, FIRST);
    await ask(build, 'как мне лучше засыпать');
    const text = await ask(build, 'я каждую ночь просыпаюсь в 4 утра — почему?');
    expect(text, 'старое окно перечня приехало в несвязанный вопрос').not.toContain(CARRIED);
  });

  it('(2) ход с приложенной заметкой окно не тянет', async () => {
    await seed();
    const build = freshBuild();
    await ask(build, FIRST);
    const attached = { blocks: [{ documentId: 'local_r12_x', title: 'Т', content: 'Текст приложенной заметки' }] };
    const text = await ask(build, 'разбери по порядку', { attached });
    expect(text, 'окно перечня ушло в ход с вложением').not.toContain(CARRIED);
  });

  it('контроль: продолжение сразу после перечня и ещё одно после него окно держат', async () => {
    await seed();
    const build = freshBuild();
    await ask(build, FIRST);
    expect(await ask(build, 'перечитай по одной')).toContain(CARRIED);
    expect(await ask(build, 'подробнее по каждой')).toContain('ОЗАРЕНИЕ_Б');
  });
});
