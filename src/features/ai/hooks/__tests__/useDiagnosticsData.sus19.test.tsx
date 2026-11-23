// NB-16 (sus19): кнопка «догрузить индекс» — флаг не лёг, а тост зелёный.
// Хук настоящий (useDiagnosticsData), моки только края: админ-данные, тост,
// i18n, auth, localStorage на ключе флага. Харнесс — из diagnosticsAdminDataErrorA2.
// Мутация: убрать ветку ok=false (всегда success) — красный а.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getUsers: vi.fn(),
  callAi: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../../../core/data', () => ({ DataProvider: { getUsers: (...a: unknown[]) => mocks.getUsers(...a) } }));
vi.mock('../../../../core/ai/callAi', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../core/ai/callAi')>();
  return { ...actual, callAi: (...a: unknown[]) => mocks.callAi(...a) };
});
vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'admin-1', email: 'admin@example.com' }),
  reauthenticate: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../auth/hooks/useAdminStatus', () => ({
  useAdminStatus: () => ({ isAdmin: true, isStaleToken: false, error: null }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { useDiagnosticsData } from '../useDiagnosticsData';

function Harness() {
  const data = useDiagnosticsData(null, false, 'users');
  return (
    <button onClick={data.handleRequestEmbeddingRestore}>restore-index</button>
  );
}

const origSetItem = Storage.prototype.setItem;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.getUsers.mockResolvedValue([]);
  mocks.callAi.mockImplementation(async (endpoint: unknown) => {
    if (endpoint === 'listUsersWithStatus') return [];
    if (endpoint === 'listAdminActions') return [];
    return {};
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('NB-16: отказ записи флага назван, а не зелёный', () => {
  it('а) флаг не записался — warning, не обещание догрузки', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (String(k).startsWith('ai_embed_restore_requested_')) throw new Error('SYNTHETIC_LS_QUOTA');
      return origSetItem.call(this, k, v);
    });
    render(<Harness />);
    fireEvent.click(await screen.findByText('restore-index'));
    expect(mocks.showToast).toHaveBeenCalledWith('ai_embed_restore_flag_failed', 'warning');
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringContaining('Индекс будет догружаться'), 'success');
  });

  it('контроль: флаг лёг — зелёное обещание как раньше', async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByText('restore-index'));
    expect(mocks.showToast).toHaveBeenCalledWith('Индекс будет догружаться частями в фоне, по мере дневного лимита чтений', 'success');
  });
});