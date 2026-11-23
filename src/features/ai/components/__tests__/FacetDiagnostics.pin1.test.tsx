// PIN-1: диагностика доменов — отказ сидов и бросок чтения названы
// error-тостом, а не тишиной. Компонент настоящий; моки только края:
// облако эмбеддингов, сиды доменов (поверх провайдера ИИ), тост.
// Мутации: убрать тост отказа сидов / catch-тост — красные а/б.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  seeds: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../services/AIEmbeddingService', () => ({
  AIEmbeddingService: { getAll: (...a: unknown[]) => mocks.getAll(...a) },
}));
vi.mock('../../utils/domainSeeds', () => ({
  getDomainSeedVectors: (...a: unknown[]) => mocks.seeds(...a),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { FacetDiagnostics } from '../FacetDiagnostics';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('language', 'ru');
  mocks.getAll.mockResolvedValue([{ id: 'e1' }]);
  mocks.seeds.mockResolvedValue([]);
});
afterEach(cleanup);

describe('PIN-1: диагностика доменов — отказ назван', () => {
  it('PIN-1: сиды доменов не посчитались — error, не тишина', async () => {
    renderWithProviders(<FacetDiagnostics />);
    fireEvent.click(screen.getByText('Диагностика порогов'));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Ошибка эмбеддинга доменов', 'error'));
    expect(mocks.showToast.mock.calls.filter(c => c[1] === 'success')).toHaveLength(0);
  });

  it('PIN-1: чтение эмбеддингов бросило — error, не пустой итог', async () => {
    mocks.getAll.mockRejectedValue(new Error('SYNTHETIC_IDB_DOWN'));
    renderWithProviders(<FacetDiagnostics />);
    fireEvent.click(screen.getByText('Диагностика порогов'));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Ошибка диагностики порогов', 'error'));
    expect(mocks.showToast.mock.calls.filter(c => c[1] === 'success')).toHaveLength(0);
  });

  it('PIN-1 контроль: эмбеддингов нет — «нечего считать», без ошибки', async () => {
    mocks.getAll.mockResolvedValue([]);
    renderWithProviders(<FacetDiagnostics />);
    fireEvent.click(screen.getByText('Диагностика порогов'));

    await waitFor(() => expect(mocks.getAll).toHaveBeenCalled());
    expect(mocks.showToast.mock.calls.filter(c => c[1] === 'error')).toHaveLength(0);
  });
});