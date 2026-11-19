// d39c: «Не показывать ИИ» — отказ облака обязан быть назван, а не показан
// успехом. Настоящие MobileNoteReader + MobileNoteActionsSheet +
// useNoteStorageActions + archiveCrud.toggleAIExclusion; моки только краёв
// (облачный DocumentService, локальный LocalDocumentService, очередь синка).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const cloudUpdate = vi.hoisted(() => vi.fn());
const localUpdate = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/core/auth', () => ({ getCurrentUser: () => ({ uid: 'u-d39c' }) }));
vi.mock('@/core/ai/useAiConsentOff', () => ({ useAiConsentOff: () => false }));
vi.mock('@/core/services/DocumentService', () => ({ DocumentService: { updateExcludedFromAI: cloudUpdate } }));
vi.mock('@/core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    updateExcludedFromAI: localUpdate,
    setMetadataDirty: vi.fn(async () => {}),
    unlinkFromCloud: vi.fn(),
    clearLocalOnlyForUpload: vi.fn(),
  },
}));
vi.mock('@/core/services/SyncService', () => ({ SyncService: { addToQueue: vi.fn(async () => {}) } }));
vi.mock('@/core/services/CloudSyncService', () => ({ CloudSyncService: { addLocalCopy: vi.fn() } }));
vi.mock('@/core/services/StorageService', () => ({
  StorageService: {
    trashDocument: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(),
    addLocalCopy: vi.fn(), addCloudCopy: vi.fn(),
  },
}));
vi.mock('@/core/events/domainEvents', () => ({ emitDomainEvent: vi.fn() }));
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/core/services/ArchiveExportService', () => ({
  exportAsDocx: vi.fn(), exportAsMd: vi.fn(), exportAsTxt: vi.fn(), isExportable: () => true,
}));
vi.mock('@/core/services/UnifiedSessionLoader', () => ({ loadSessionContent: vi.fn() }));
vi.mock('@/app/useAuthStatus', () => ({ useAuthStatus: () => ({ profile: {}, user: { uid: 'u-d39c' } }) }));
vi.mock('@/app/UnlockPrompt', () => ({ UnlockPrompt: () => null }));
vi.mock('@/app/EncryptionPasswordModal', () => ({ EncryptionPasswordModal: () => null }));

import { MobileNoteReader } from '@/features/archive/components/MobileNoteReader';
import { ToastProvider } from '@/shared/components/Toast';
import { LanguageProvider } from '@/shared/i18n';
import type { ArchiveSession } from '@/features/archive/types';

const session = {
  id: 'local_d39c',
  userId: 'u-d39c',
  title: 'Заметка d39c',
  content: 'MARKER_DAILY_TEXT',
  createdAt: Date.now(),
  duration: 60,
  wordCount: 2,
  tags: [],
  excludedFromAI: false,
  _isLocal: true,
  _linkedCloudId: 'cloud_d39c',
  _hasCloudCopy: true,
} as unknown as ArchiveSession;

function renderReader() {
  return render(
    h(LanguageProvider, null,
      h(ToastProvider, null,
        h(MobileNoteReader, { session, onClose: vi.fn(), onContinue: vi.fn() }))),
  );
}

async function excludeViaSheet() {
  fireEvent.click(screen.getByRole('button', { name: 'Действия с заметкой' }));
  const excludeBtn = await screen.findByText('Не показывать ИИ');
  fireEvent.click(excludeBtn);
  const confirmBtn = await screen.findByText('Да, скрыть от ИИ');
  fireEvent.click(confirmBtn);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localUpdate.mockImplementation(async () => {});
});

describe('d39c: отказ облака при скрытии от ИИ не показывается успехом', () => {
  it('облако отказало — тост ошибки про облако, а не «Скрыто от ИИ»', async () => {
    cloudUpdate.mockRejectedValue(new Error('MARKER_DAILY_CLOUD_DOWN'));
    renderReader();
    await excludeViaSheet();
    await waitFor(() => {
      expect(localUpdate).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(
        screen.queryByText('Облачная копия не синхронизирована') ?? screen.queryByText('Скрыто от ИИ'),
        'итог действия должен быть назван',
      ).toBeTruthy();
    });
    expect(screen.queryByText('Скрыто от ИИ'), 'отказ облака показан как успех').toBeNull();
    expect(screen.getByText('Облачная копия не синхронизирована')).toBeTruthy();
  });

  it('КОНТРОЛЬ: облако ответило — тост «Скрыто от ИИ», ошибки нет', async () => {
    cloudUpdate.mockResolvedValue(undefined);
    renderReader();
    await excludeViaSheet();
    await waitFor(() => {
      expect(screen.getByText('Скрыто от ИИ')).toBeTruthy();
    });
    expect(screen.queryByText('Облачная копия не синхронизирована')).toBeNull();
  });
});
