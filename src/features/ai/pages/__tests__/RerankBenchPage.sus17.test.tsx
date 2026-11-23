// NB-17 №17 (sus17): «читать заметку целиком» в бенче реранка — отказ чтения
// текста был необработанным промисом (void в onClick), строка оставалась
// пустой без объяснения. Теперь try и error-строка. Компонент настоящий;
// мок только края (чтение версии из IndexedDB). Мутация: убрать try/catch —
// красный а.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { RerankBenchPage } from '../RerankBenchPage';

const getLatestContent = vi.fn();
vi.mock('../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: { getLatestContent: (...a: unknown[]) => getLatestContent(...a) },
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const STATE_KEY = 'rerank_bench_state_v1';

function seedState() {
  localStorage.setItem(STATE_KEY, JSON.stringify({
    queriesText: 'синтетический запрос',
    startedAt: 1000,
    runs: [{
      query: 'синтетический запрос',
      rrfTop5: ['doc_x'], rerankTop5: ['doc_x'], judged: ['doc_x'],
      meta: { doc_x: { title: 'Синтетика', excerpt: 'кусок текста' } },
      verdicts: {}, bypassed: false,
    }],
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seedState();
});
afterEach(cleanup);

describe('NB-17 №17: отказ чтения полного текста назван', () => {
  it('а) чтение отказало — error-строка, а не тишина', async () => {
    getLatestContent.mockRejectedValue(new Error('SYNTHETIC_IDB'));
    renderWithProviders(<ToastProvider><RerankBenchPage /></ToastProvider>);
    fireEvent.click(screen.getByText('читать заметку целиком'));
    expect(await screen.findByText('Не удалось прочитать текст заметки')).toBeTruthy();
  });

  it('контроль: текст прочитан — показан целиком', async () => {
    getLatestContent.mockResolvedValue('Полный синтетический текст заметки');
    renderWithProviders(<ToastProvider><RerankBenchPage /></ToastProvider>);
    fireEvent.click(screen.getByText('читать заметку целиком'));
    expect(await screen.findByText('Полный синтетический текст заметки')).toBeTruthy();
  });
});