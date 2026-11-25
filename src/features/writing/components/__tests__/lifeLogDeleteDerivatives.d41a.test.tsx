// d41a (Н-1): LifeLogPanel.requestDelete читает applied и cloudSynced, но не
// derivativesOk: уборка производных упала (failed>0 в cascadeDeleteAIDerivatives),
// а тост зелёный «Сессия удалена». Сосед useArchiveSessions:155-160 при том же
// возврате показывает warning session_deleted_partial. Настоящие
// SessionDeleteService + StorageService + withDocumentLock поверх fake-indexeddb;
// моки только края (локальное удаление, облачное удаление, список сессий).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createElement as h, type ReactNode } from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/shared/components/Toast';

const localDelete = vi.hoisted(() => vi.fn());
const cloudRemove = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/features/writing/hooks/useLifeLog', () => ({
  useLifeLog: () => ({
    sessionGroups: [{
      date: new Date('2026-11-20T00:00:00'),
      label: 'Сегодня',
      sessions: [{
        id: 'local_d41a', _isLocal: true, title: 'd41a', content: 'MARKER_DAILY_TEXT',
        createdAt: '2026-11-20T08:00:00.000Z', wordCount: 3, duration: 60,
      }],
    }],
    summary: { totalWords: 3, totalMinutes: 1 },
    loading: false,
    cloudUnknown: false,
    refresh,
    unifiedDocuments: [],
  }),
}));
vi.mock('@/shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock('@/app/useAuthStatus', () => ({ useAuthStatus: () => ({ isGuest: false }) }));
vi.mock('@/shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string, n: number) => `${k}:${n}`, language: 'ru' }),
}));
vi.mock('@/core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    getDocument: vi.fn(async () => ({ id: 'local_d41a', linkedCloudId: 'cloud_d41a' })),
  },
}));
vi.mock('@/core/services/LocalStorageService', () => ({
  LocalStorageService: { deleteDocument: localDelete },
}));
vi.mock('@/core/services/CloudSyncService', () => ({
  CloudSyncService: { removeCloudCopy: cloudRemove },
}));
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { getLocalDb } from '@/core/storage/localDb';
import { LifeLogPanel } from '@/features/writing/components/LifeLogPanel';

// Как настоящий (SB-2): удаление строки ставит задачу снести облачный ряд.
const localDeletes = (ok: boolean) => localDelete.mockImplementation(async (_id: string, owner: string) => {
  await (await getLocalDb(owner)).put('syncQueue', { id: 'delete_t', documentId: 'cloud_d41a', type: 'delete', createdAt: 1, ownerId: owner, revocable: true });
  return ok;
});

const wrapper = ({ children }: { children: ReactNode }) => h(ToastProvider, null, children);

function renderPanel() {
  return render(
    h(LifeLogPanel, {
      userId: 'u-d41a',
      onContinueSession: vi.fn(),
      onClose: vi.fn(),
      activeTab: 'log' as const,
      onTabChange: vi.fn(),
    }),
    { wrapper },
  );
}

beforeEach(() => { cleanup(); vi.clearAllMocks(); });

describe('d41a: отказ уборки производных при удалении сессии назван, а не «Удалена»', () => {
  it('derivativesOk=false при живом облаке — warning partial, а не success', async () => {
    localDeletes(false); // cascadeDeleteAIDerivatives: failed>0
    cloudRemove.mockResolvedValue(undefined);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'session_delete' }));
    await waitFor(() => {
      expect(
        screen.queryByText('session_deleted') ?? screen.queryByText('session_deleted_partial'),
        'итог удаления должен быть назван',
      ).toBeTruthy();
    // Первый тест файла платит холодную загрузку панели: под полным прогоном (все воркеры)
    // 1 с по умолчанию не хватило (20.11, один раз из прогона; отдельно 3/3 зелёный).
    }, { timeout: 3000 });
    expect(localDelete).toHaveBeenCalled();
    expect(screen.queryByText('session_deleted'), 'отказ производных показан как полный успех').toBeNull();
    expect(screen.getByText('session_deleted_partial')).toBeTruthy();
  });

  it('КОНТРОЛЬ: производные убраны, облако ответило — success «Сессия удалена»', async () => {
    localDeletes(true);
    cloudRemove.mockResolvedValue(undefined);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'session_delete' }));
    await waitFor(() => { expect(screen.getByText('session_deleted')).toBeTruthy(); });
    expect(screen.queryByText('session_deleted_partial')).toBeNull();
  });

  it('КОНТРОЛЬ: облако отказало — warning «удалено здесь, досыл в очереди» (ветка cloudSynced держит)', async () => {
    localDeletes(true);
    cloudRemove.mockRejectedValue(new Error('MARKER_DAILY_CLOUD_DOWN'));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'session_delete' }));
    await waitFor(() => { expect(screen.getByText('delete_local_only_queued')).toBeTruthy(); });
    expect(screen.queryByText('session_deleted')).toBeNull();
  });
});
