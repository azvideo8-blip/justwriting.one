import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { renderWithProviders } from '../../../test/utils/render';
import { MassAnalyzeNotes } from '../DiagnosticsPage';
import { getLocalDb } from '../../../core/storage/localDb';
import { AIService } from '../../../features/ai/services/AIService';
import { AIBackgroundBudget } from '../../../features/ai/services/AIBackgroundBudget';

vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../core/auth', () => ({ getCurrentUser: vi.fn(() => null) }));
vi.mock('../../../shared/i18n', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../shared/i18n')>();
  return {
    ...actual,
    useLanguage: () => ({ t: (key: string) => key, language: 'ru', setLanguage: vi.fn() }),
  };
});

// TH-3, дыра в «диагностике»: массовый разбор на странице диагностики выбирал
// заметки как «все, у кого нет сводки» и не спрашивал разрешение на ИИ. Заметка,
// скрытая от ИИ или лежащая в корзине, уезжала поставщику целиком. У настоящего
// входа (`NoteAnalysisService.findPending`) фильтр есть — здесь была его копия
// без фильтра.
//
// Маркеры выдуманные, живых формулировок здесь нет.

const VISIBLE_MARKER = 'ВИДИМАЯ-ЗАМЕТКА-ДЛЯ-РАЗБОРА-TH3';
const HIDDEN_MARKER = 'СКРЫТАЯ-ЗАМЕТКА-НЕ-ДЛЯ-ИИ-TH3';
const TRASHED_MARKER = 'КОРЗИНА-НЕ-ДЛЯ-ИИ-TH3';

const filler = (marker: string) => `${marker}. ${'текст '.repeat(12)}`;

describe('TH-3: массовый разбор в диагностике не отправляет скрытую заметку поставщику', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.restoreAllMocks();
    const db = await getLocalDb();
    for (const store of ['documents', 'versions', 'aiSummaries', 'aiTimeline'] as const) {
      await db.clear(store);
    }

    const doc = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      guestId: 'guest',
      title: id,
      currentVersion: 1,
      totalWords: 20,
      totalDuration: 100,
      sessionsCount: 1,
      firstSessionAt: Date.now(),
      lastSessionAt: Date.now(),
      tags: [],
      ...extra,
    });
    const version = (id: string, marker: string) => ({
      id: `v_${id}`,
      documentId: id,
      guestId: 'guest',
      version: 1,
      content: filler(marker),
      wordCount: 20,
      savedAt: Date.now(),
    });

    await db.put('documents', doc('doc_visible_th3') as never);
    await db.put('versions', version('doc_visible_th3', VISIBLE_MARKER) as never);

    await db.put('documents', doc('doc_hidden_th3', { excludedFromAI: true }) as never);
    await db.put('versions', version('doc_hidden_th3', HIDDEN_MARKER) as never);

    await db.put('documents', doc('doc_trashed_th3', { trashedAt: Date.now() }) as never);
    await db.put('versions', version('doc_trashed_th3', TRASHED_MARKER) as never);

    vi.spyOn(AIBackgroundBudget, 'canSpend').mockReturnValue(true);
    vi.spyOn(AIBackgroundBudget, 'spend').mockImplementation(() => {});
  });

  it('поставщику уходит только видимая заметка', async () => {
    const summarize = vi.spyOn(AIService, 'summarize').mockResolvedValue({
      ok: true,
      summary: { tone: 'нейтрально', frequentWords: [], insights: [], themes: [], extractedFacts: [] },
    } as never);

    renderWithProviders(<MassAnalyzeNotes />);
    const button = (await screen.findByText('admin_mass_analyze_now')).closest('button')!;
    // Кнопка ждёт `loadStats`: до ответа она disabled, и клик ничего не делает.
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    const sentNow = () => summarize.mock.calls.map(call => String((call[0] as { content?: string }).content ?? ''));

    // Контроль: видимая заметка действительно уехала — иначе проверка ниже
    // зеленела бы на «ничего не отправлено». Между вызовами разбор спит 500 мс.
    await waitFor(() => expect(sentNow().some(text => text.includes(VISIBLE_MARKER))).toBe(true), { timeout: 8000 });
    const sent = sentNow();
    expect(sent.some(text => text.includes(HIDDEN_MARKER))).toBe(false);
    expect(sent.some(text => text.includes(TRASHED_MARKER))).toBe(false);
  });
});
