// Доделки load-state 19.11: «удаление не применено» и «только на этом устройстве»
// в журнале жизни шли тостом без типа — то есть зелёным «успехом».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { LifeLogPanel } from '../LifeLogPanel';

const showToast = vi.hoisted(() => vi.fn());
const deleteSession = vi.hoisted(() => vi.fn());

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: async () => true }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isGuest: false }) }));
vi.mock('../../services/SessionDeleteService', () => ({ deleteSession }));
// Дейлик 20.11: useServiceAction больше не подменяется — путь броска идёт через
// настоящий хук (тост ошибки, без тоста успеха).
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../hooks/useLifeLog', () => ({
  useLifeLog: () => ({
    sessionGroups: [{ label: 'сегодня', date: new Date('2026-11-19T00:00:00Z'), sessions: [{ id: 's1', title: 'Синтетика', wordCount: 10, createdAt: new Date('2026-11-19T10:00:00Z') }] }],
    summary: { totalWords: 10, totalMinutes: 1 },
    loading: false,
    cloudUnknown: false,
    refresh: vi.fn(async () => {}),
    unifiedDocuments: [],
  }),
}));

async function deleteWith(result: { applied: boolean; cloudSynced: boolean; derivativesOk: boolean }) {
  deleteSession.mockResolvedValue(result);
  render(<LifeLogPanel userId="u1" onContinueSession={vi.fn()} onClose={vi.fn()} activeTab="log" onTabChange={vi.fn()} pinned={false} onTogglePin={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'session_delete' }));
  await waitFor(() => expect(showToast).toHaveBeenCalled());
}

describe('журнал жизни: итог удаления назван правильным цветом', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); });

  it('не применено — предупреждение', async () => {
    await deleteWith({ applied: false, cloudSynced: false, derivativesOk: true });
    expect(showToast).toHaveBeenCalledWith('delete_not_applied_uploading', 'warning');
  });

  it('только на этом устройстве — предупреждение', async () => {
    await deleteWith({ applied: true, cloudSynced: false, derivativesOk: true });
    expect(showToast).toHaveBeenCalledWith('delete_local_only_queued', 'warning');
  });

  it('облако ответило, но уборка производных ИИ отказала — предупреждение, не успех', async () => {
    await deleteWith({ applied: true, cloudSynced: true, derivativesOk: false });
    expect(showToast).toHaveBeenCalledWith('session_deleted_partial', 'warning');
    expect(showToast).not.toHaveBeenCalledWith('session_deleted', 'success');
  });

  it('удалено везде — успех', async () => {
    await deleteWith({ applied: true, cloudSynced: true, derivativesOk: true });
    expect(showToast).toHaveBeenCalledWith('session_deleted', 'success');
  });

  // Мутация: в LifeLogPanel снять errorMessage или показать успех до итога —
  // красный (ожидается именно «удалить не вышло», без зелёного).
  it('удаление бросило — ошибка удаления, без тоста успеха', async () => {
    deleteSession.mockRejectedValue(new Error('idb down'));
    render(<LifeLogPanel userId="u1" onContinueSession={vi.fn()} onClose={vi.fn()} activeTab="log" onTabChange={vi.fn()} pinned={false} onTogglePin={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'session_delete' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('error_delete_failed', 'error'));
    expect(showToast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });
});

