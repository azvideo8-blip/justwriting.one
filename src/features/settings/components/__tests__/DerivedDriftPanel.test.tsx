import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join('/')}` : k),
  }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
const showToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));

import { DerivedDriftPanel, type DerivedDriftView } from '../DerivedDriftPanel';

const drift = (over: Partial<DerivedDriftView> = {}): DerivedDriftView => ({
  notes: 171,
  summaries: { local: 166, cloud: 166, orphaned: 17 },
  embeddings: { local: 37, cloud: 30, orphaned: 0, oversized: 0 },
  stores: { local: 250, cloud: 258 },
  ...over,
});

async function open(view: DerivedDriftView) {
  const onLoad = vi.fn().mockResolvedValue(view);
  render(<DerivedDriftPanel userId="u1" onLoad={onLoad} />);
  // drift-1, задача 3: только по нажатию. Опрос при открытии настроек (и тем
  // более по таймеру) уже однажды выбрал дневную квоту чтений.
  expect(onLoad).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'settings_drift_check' }));
  await screen.findByTestId('drift-row-summaries');
  expect(onLoad).toHaveBeenCalledTimes(1);
  return onLoad;
}

const row = (family: string) => within(screen.getByTestId(`drift-row-${family}`));

describe('drift-1: device-vs-cloud panel', () => {
  it('shows the three families with a verdict each', async () => {
    await open(drift());

    expect(row('summaries').getByText('settings_drift_match')).toBeTruthy();
    expect(row('summaries').getByText(/166/)).toBeTruthy();
    // На устройстве больше — это то, что можно потерять.
    expect(row('embeddings').getByText('settings_drift_missing:7')).toBeTruthy();
    // В облаке больше — обычное дело на втором устройстве, не тревога.
    expect(row('stores').getByText('settings_drift_extra:8')).toBeTruthy();
    // Недостающее закрывает кнопка выгрузки — панель на неё указывает.
    expect(screen.getByText('settings_drift_hint_missing')).toBeTruthy();
  });

  it('names records that cannot be sent on a line of their own, and hides empty lines', async () => {
    await open(drift());

    expect(screen.getByText('settings_drift_orphan_summaries:17')).toBeTruthy();
    expect(screen.queryByText(/settings_drift_orphan_embeddings/)).toBeNull();
    expect(screen.queryByText(/settings_drift_oversized/)).toBeNull();
  });

  it('says that semantic search sees only part of the archive', async () => {
    await open(drift());
    expect(screen.getByText('settings_drift_vectors_behind:37/171')).toBeTruthy();
  });

  /**
   * K-4/N-85, хвост: сервис отдаёт «не удалось посчитать» как null. Экран,
   * который покажет на его месте 0, скажет человеку «данных нет» — ровно то,
   * от чего контракт и менялся. Красный при `value ?? 0` в отрисовке.
   */
  it('renders "could not count" instead of 0 when a read failed', async () => {
    await open(drift({
      notes: null,
      summaries: { local: null, cloud: 166, orphaned: null },
      embeddings: { local: null, cloud: null, orphaned: null, oversized: null },
      stores: { local: null, cloud: 258 },
    }));

    for (const family of ['summaries', 'embeddings', 'stores']) {
      expect(row(family).getAllByText(/settings_drift_unknown/).length).toBeGreaterThan(0);
      expect(row(family).queryByText(/(^|\D)0(\D|$)/)).toBeNull();
      // Без обоих чисел вывода нет: ни «совпадает», ни «не хватает».
      expect(row(family).queryByText(/settings_drift_(match|missing|extra)/)).toBeNull();
    }
    expect(screen.queryByText(/settings_drift_(notes|vectors_behind|orphan|oversized)/)).toBeNull();
  });

  it('recounts on the button and reports a thrown load without showing stale numbers as fresh', async () => {
    const onLoad = await open(drift());
    onLoad.mockRejectedValueOnce(new Error('boom'));

    fireEvent.click(screen.getByRole('button', { name: 'settings_drift_refresh' }));

    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('error_generic_action', 'error'));
    expect(onLoad).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('drift-row-summaries')).toBeNull();
  });
});
