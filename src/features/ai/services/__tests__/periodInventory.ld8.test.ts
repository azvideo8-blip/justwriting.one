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

// LD-8: «перечисли все мои X за октябрь» получал ответ из топ-10 и утверждал,
// что это всё. Теперь у хода-перечня есть список всех записей периода и честная
// строка о том, сколько пришло полным текстом. Фикстуры синтетические.
const DAY = 86_400_000;
const OCT_1 = Date.UTC(2026, 9, 1);

// Восемь видимых заметок октября + одна скрытая от ИИ + одна в корзине.
const NOTES = [
  { id: 'local_ld8_01', day: 1, summary: 'Заметка про утренний бег.' },
  { id: 'local_ld8_02', day: 3, summary: 'Заметка про разговор с мамой.' },
  { id: 'local_ld8_03', day: 5, summary: 'Заметка про просроченный проект.' },
  { id: 'local_ld8_04', day: 8, summary: 'Заметка про прививку собаки.' },
  { id: 'local_ld8_05', day: 12, summary: 'Заметка про отказ от кофе.' },
  { id: 'local_ld8_06', day: 17, summary: 'Заметка про ремонт крана.' },
  { id: 'local_ld8_07', day: 21, summary: 'Заметка про письмо старому другу.' },
  { id: 'local_ld8_08', day: 26, summary: 'Заметка про вечер без экрана.' },
  { id: 'local_ld8_hidden', day: 9, summary: 'СПРЫНУТАЯ_СУТЬ_про страх выступления.', excludedFromAI: true },
  { id: 'local_ld8_trash', day: 14, summary: 'КОРЗИНА_СУТЬ_про ссору.', trashedAt: true },
];

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings', 'versions'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  for (const n of NOTES) {
    await db.put('documents', {
      id: n.id, guestId: 'u1', title: `Октябрь ${String(n.day).padStart(2, '0')}`, currentVersion: 1,
      totalWords: 40, totalDuration: 60, sessionsCount: 1,
      firstSessionAt: OCT_1 + (n.day - 1) * DAY, lastSessionAt: OCT_1 + (n.day - 1) * DAY, tags: [],
      ...(n.excludedFromAI ? { excludedFromAI: true } : {}),
      ...(n.trashedAt ? { trashedAt: OCT_1 } : {}),
    } as never);
    await db.put('aiSummaries', { documentId: n.id, processedAt: OCT_1, summary: n.summary, themes: [] } as never);
  }
  vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => `Тело ${id}`);
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]] } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(
    NOTES.map(n => ({ documentId: n.id, vectors: [[1, 0]], chunkTexts: [`Тело ${n.id}`], contentHash: `h${n.id}`, processedAt: OCT_1, model: 'm', dim: 2 })) as never,
  );
}

// Полный текст в материалах — три заметки (как если бы топ-10 выбрал три).
const FULL_TEXT_IDS = ['local_ld8_03', 'local_ld8_06', 'local_ld8_08'];

function stubSearch(ids: string[]) {
  vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({
    notes: ids.map(id => ({
      documentId: id, title: `Октябрь ${id.slice(-2)}`, content: `Тело ${id}`, score: 0.03,
      lastSessionAt: OCT_1 + (Number(id.slice(-2)) - 1) * DAY,
    })),
    failed: false, degraded: false,
  } as never);
}

async function askFull(text: string) {
  const { result } = renderHook(() => useAIChatContext('coach'));
  return result.current.buildContext({
    text,
    attached: undefined,
    mood: undefined,
    messageHistory: [{ role: 'user', content: text }],
    isFirstTurn: false,
    scope: 'wide',
  } as never);
}

async function ask(text: string): Promise<string> {
  const { result } = renderHook(() => useAIChatContext('coach'));
  const ctx = await result.current.buildContext({
    text,
    attached: undefined,
    mood: undefined,
    messageHistory: [{ role: 'user', content: text }],
    isFirstTurn: false,
    scope: 'wide',
  } as never);
  return ctx.searchContext ?? '';
}

describe('LD-8: перечень записей периода и честная полнота', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('ход-перечень: список всех видимых заметок месяца по датам, скрытая и корзина не названы', async () => {
    await seed();
    stubSearch(FULL_TEXT_IDS);
    const block = await ask('перечисли все мои осознания за октябрь 2026');

    for (const n of NOTES) {
      if (n.excludedFromAI || n.trashedAt) continue;
      expect(block, `нет строки ${n.id}`).toContain(`[#${n.id} · 2026-10-${String(n.day).padStart(2, '0')}] ${n.summary}`);
    }
    expect(block).not.toContain('СПРЫНУТАЯ_СУТЬ');
    expect(block).not.toContain('КОРЗИНА_СУТЬ');
    expect(block).not.toContain('[#local_ld8_hidden');
    expect(block).not.toContain('[#local_ld8_trash');

    // Порядок — по датам возрастания.
    const at = (id: string) => block.indexOf(`[#${id} ·`);
    expect(at('local_ld8_02')).toBeGreaterThan(at('local_ld8_01'));
    expect(at('local_ld8_05')).toBeGreaterThan(at('local_ld8_04'));
    expect(at('local_ld8_08')).toBeGreaterThan(at('local_ld8_07'));
    // Восемь строк перечня — ровно видимые заметки месяца (скрытая и корзина не в счёт).
    expect((block.match(/^\[#local_ld8_\d\d · 2026-10-\d\d\] Заметка /gm) ?? []).length).toBe(8);
  });

  it('полный текст пришёл не по всем записям периода — в материалах это сказано', async () => {
    await seed();
    stubSearch(FULL_TEXT_IDS);
    const block = await ask('перечисли все мои осознания за октябрь 2026');
    expect(block).toMatch(/за период 8 заметок, в материалах полный текст у 3/);
  });

  // Ревью LD-8 (сторож): модель ссылается на строки перечня, и фильтр ссылок
  // обязан их пропустить — их id берёт общий разбор [#id] из текста контекста;
  // скрытая и корзина в разрешённые не попадают.
  it('id заметок перечня разрешены для ссылок, скрытая и корзина — нет', async () => {
    await seed();
    stubSearch(FULL_TEXT_IDS);
    const ctx = await askFull('перечисли все мои осознания за октябрь 2026');
    const allowed = new Set(ctx.injectedDocumentIds ?? []);
    for (const n of NOTES) {
      if (n.excludedFromAI || n.trashedAt) expect(allowed.has(n.id), n.id).toBe(false);
      else expect(allowed.has(n.id), n.id).toBe(true);
    }
    expect(ctx.searchContext).toMatch(/за период 8 заметок, в материалах полный текст у 3/);
  });

  it('месячный вопрос без просьбы о перечне — списка нет', async () => {
    await seed();
    stubSearch(FULL_TEXT_IDS);
    const block = await ask('что было в октябре 2026?');
    expect(block).not.toContain('[Все записи периода');
    // Строка о полноте при этом остаётся: она про материалы, а не про перечень.
    expect(block).toMatch(/за период 8 заметок/);
  });

  it('окно короче месяца (последняя неделя) тоже получает перечень', async () => {
    await seed();
    // Относительное окно: заметки недели относительно «сегодня».
    const db = await getLocalDb();
    const at = (daysAgo: number, hour: number) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      d.setHours(hour, 0, 0, 0);
      return d.getTime();
    };
    const recent = [
      { id: 'local_ld8_w1', at: at(1, 10), ago: 1, summary: 'Свежая суть понедельника.' },
      { id: 'local_ld8_w2', at: at(1, 18), ago: 1, summary: 'Свежая суть середины недели.' },
      { id: 'local_ld8_old', at: at(40, 12), ago: 40, summary: 'СТАРЫЙ_СЮЖЕТ вне окна.' },
    ];
    for (const n of recent) {
      await db.put('documents', {
        id: n.id, guestId: 'u1', title: `Неделя ${n.ago}`, currentVersion: 1, totalWords: 20, totalDuration: 30, sessionsCount: 1,
        firstSessionAt: n.at, lastSessionAt: n.at, tags: [],
      } as never);
      await db.put('aiSummaries', { documentId: n.id, processedAt: n.at, summary: n.summary, themes: [] } as never);
    }
    stubSearch(FULL_TEXT_IDS);
    const block = await ask('перечисли каждый день, что было вчера');
    expect(block).toContain(`[#local_ld8_w1 · `);
    expect(block).toContain('Свежая суть середины недели.');
    expect((block.match(/^\[#local_ld8_w\d · /gm) ?? []).length).toBe(2);
    expect(block).not.toContain('СТАРЫЙ_СЮЖЕТ');
  });

  it('длинный период (год) перечня не получает', async () => {
    await seed();
    stubSearch(FULL_TEXT_IDS);
    const block = await ask('в этом году перечисли все заметки');
    expect(block).not.toContain('[Все записи периода');
  });

  it('больше шестидесяти записей — список обрезан и это сказано', async () => {
    await seed();
    const db = await getLocalDb();
    for (let i = 1; i <= 55; i++) {
      const id = `local_extra_${String(i).padStart(2, '0')}`;
      await db.put('documents', {
        id, guestId: 'u1', title: `Доп ${i}`, currentVersion: 1, totalWords: 10, totalDuration: 30, sessionsCount: 1,
        firstSessionAt: OCT_1 + 12 * DAY, lastSessionAt: OCT_1 + 12 * DAY, tags: [],
      } as never);
      await db.put('aiSummaries', { documentId: id, processedAt: OCT_1, summary: `Дополнительная суть ${i}`, themes: [] } as never);
    }
    stubSearch(FULL_TEXT_IDS);
    const block = await ask('перечисли все заметки за октябрь 2026');
    expect(block).toContain('…и ещё 3');
    expect(block).toMatch(/за период 63 заметок/);
  });
});
