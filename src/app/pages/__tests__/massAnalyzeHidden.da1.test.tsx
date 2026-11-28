// DA-1 (дейлик 27.11, Н-1): «Пакетный анализ» в Диагностике решал «скрыта ли заметка»
// по снимку в начале прохода. Скрыли заметку, пока шёл разбор предыдущей, — её текст
// всё равно уходил модели, а свод записывался. Настоящий MassAnalyzeNotes и настоящий
// NoteAnalysisService над IndexedDB; подменён край — вызов модели и вектор.
// Мутация: вернуть в handleMassAnalyze свой цикл со снимком — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const showToast = vi.fn();
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../core/auth', async importActual => ({ ...(await importActual<object>()), getCurrentUser: () => ({ uid: 'u-da1' }) }));
vi.mock('../../../features/ai/utils/embeddingIndexer', async importActual => ({
  ...(await importActual<object>()),
  indexDocument: vi.fn(async () => 'skip'),
  indexPending: vi.fn(async () => ({ ok: 0 })),
}));

import { MassAnalyzeNotes } from '../DiagnosticsPage';
import { AIService } from '../../../features/ai/services/AIService';
import { AISummaryService } from '../../../features/ai/services/AISummaryService';
import { getLocalDb } from '../../../core/storage/localDb';

const TEXT_A = 'MARKER_A Первая заметка, достаточно длинная, чтобы её разбирать целиком.';
const TEXT_B = 'MARKER_B Вторая заметка, которую скроют от ИИ, пока разбирается первая.';

const doc = (id: string, n: number) => ({
  id, guestId: 'u-da1', title: id, currentVersion: 1, totalWords: 10, totalDuration: 0, sessionsCount: 1,
  firstSessionAt: n, lastSessionAt: n, tags: [],
});
const ver = (documentId: string, content: string) => ({
  id: `v-${documentId}`, documentId, guestId: 'u-da1', version: 1, content, wordCount: 10, duration: 0, wpm: 0,
  sessionStartedAt: new Date(1), savedAt: new Date(1),
});

const summarize = vi.spyOn(AIService, 'summarize');
const save = vi.spyOn(AISummaryService, 'save');

beforeEach(async () => {
  vi.clearAllMocks();
  const db = await getLocalDb();
  for (const s of ['documents', 'versions', 'aiSummaries'] as const) await db.clear(s);
  await db.put('documents', doc('a', 2) as never);
  await db.put('documents', doc('b', 1) as never);
  await db.put('versions', ver('a', TEXT_A) as never);
  await db.put('versions', ver('b', TEXT_B) as never);
  save.mockImplementation(async s => { await (await getLocalDb()).put('aiSummaries', s as never); return 'saved'; });
  summarize.mockImplementation(async ({ content }) => {
    // Пока модель разбирает первую заметку, вторую скрывают от ИИ.
    if (content.includes('MARKER_A')) {
      const db = await getLocalDb();
      await db.put('documents', { ...(await db.get('documents', 'b'))!, excludedFromAI: true } as never);
    }
    return { ok: true, summary: { tone: 't', frequentWords: [], insights: [], themes: [], extractedFacts: [] } } as never;
  });
});

describe('DA-1: пакетный анализ перечитывает видимость перед каждой заметкой', () => {
  it('заметку скрыли во время прохода — её текст модели не уходит, свод не пишется', async () => {
    render(<MassAnalyzeNotes />);
    const button = await screen.findByRole('button', { name: /admin_mass_analyze_now/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(showToast).toHaveBeenCalled(), { timeout: 10_000 });

    const sent = summarize.mock.calls.map(c => c[0].content);
    expect(sent.some(c => c.includes('MARKER_A'))).toBe(true);
    expect(sent.some(c => c.includes('MARKER_B'))).toBe(false);
    const db = await getLocalDb();
    expect(await db.get('aiSummaries', 'b')).toBeUndefined();
  }, 15_000);

  // Ревью DA-1: бюджет проверялся один раз, проход брал 10 заметок. Мутация: limit 10
  // без учёта остатка — красный.
  it('остаток бюджета 1 — разбирается одна заметка', async () => {
    const { AIBackgroundBudget } = await import('../../../features/ai/services/AIBackgroundBudget');
    vi.spyOn(AIBackgroundBudget, 'budgetStatus').mockReturnValue({ spent: 24, budget: 25 });
    summarize.mockResolvedValue({ ok: true, summary: { tone: 't', frequentWords: [], insights: [], themes: [], extractedFacts: [] } } as never);
    render(<MassAnalyzeNotes />);
    const button = await screen.findByRole('button', { name: /admin_mass_analyze_now/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(showToast).toHaveBeenCalled(), { timeout: 10_000 });
    expect(summarize).toHaveBeenCalledTimes(1);
  }, 15_000);
});
