// Ревью 0.11.25 N-3/R2-N1: в облаке есть нечитаемые заметки — окно восстановления говорит
// «сохранено 3» и «не прочиталась (3)», без второго чтения облака. Мутации: не передавать
// initialCloudUnreadable из FirstEntryModals / не брать его в окне — красный.
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils/render';

const h = vi.hoisted(() => ({ unreadable: 3, read: vi.fn() }));
vi.mock('../../core/sync/useEmptyDeviceDetection', () => ({
  useEmptyDeviceDetection: () => ({ shouldPrompt: true, localCount: 0, cloudCount: 3, cloudUnreadable: h.unreadable, dismiss: vi.fn() }),
}));
vi.mock('../../features/auth/hooks/useOtherUserDetection', () => ({
  useOtherUserDetection: () => ({ hasOtherData: false, dismiss: vi.fn(), clear: vi.fn() }),
}));
vi.mock('../../features/auth/hooks/useAuthStatus', () => ({ useAuthStatus: () => ({ user: { uid: 'u_r25' }, profile: null }) }));
vi.mock('../../core/services/DocumentService', () => ({ DocumentService: { getUserDocuments: h.read } }));

import { FirstEntryModals } from '../FirstEntryModals';

describe('окно восстановления при нечитаемых заметках', () => {
  it('есть нечитаемые → названы, число облака не ноль, облако второй раз не читается', async () => {
    h.unreadable = 3;
    renderWithProviders(<FirstEntryModals />);
    expect((await screen.findByTestId('restore-cloud-partial', {}, { timeout: 5000 })).textContent).toContain('3');
    expect(screen.getByText(/в облаке сохранено 3/)).toBeTruthy();
    expect(h.read).not.toHaveBeenCalled();
  });

  it('контроль: все читаются → строки о нечитаемых нет', async () => {
    h.unreadable = 0;
    renderWithProviders(<FirstEntryModals />);
    expect(await screen.findByText(/в облаке сохранено 3/, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('restore-cloud-partial')).toBeNull();
  });
});
