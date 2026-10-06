import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useNoteStorageActions, type StorageDoc, type AIExclusion } from '../useNoteStorageActions';

// X-6 (доступность): подтверждение «Скрыть эту заметку от ИИ?» рисовалось
// самодельным оверлеем без role=dialog, aria-modal, подписи и переноса фокуса.
// Скринридер слышал только две кнопки с одним именем — «Не показывать ИИ» и
// «Не показывать ИИ» — и не различал, где спрос, а где действие.
const mockShowToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'ru' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), removeLocalCopy: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn() },
}));
vi.mock('../../../../core/services/SyncService', () => ({ SyncService: { syncDocument: vi.fn() } }));
vi.mock('../../../../core/crypto/encrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/crypto/encrypt')>();
  return { ...actual, getSessionKey: vi.fn(() => null) };
});
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ profile: { encryptionMeta: null, encryptionSalt: null, encryptedDataKey: null }, user: { uid: 'user_x6' } }),
}));
vi.mock('../../../../app/UnlockPrompt', () => ({ UnlockPrompt: () => <div data-testid="mock-unlock" /> }));
vi.mock('../../../../app/EncryptionPasswordModal', () => ({ EncryptionPasswordModal: () => null }));

const exclusionOnClick = vi.fn();
const exclusion: AIExclusion = { excluded: false, loading: false, onClick: exclusionOnClick };

function Harness({ doc }: { doc: StorageDoc }) {
  const api = useNoteStorageActions({
    doc,
    userId: 'user_x6',
    onStorageChange: () => {},
    exclusion,
  });
  return (
    <>
      <button onClick={api.requestExclusion}>open-exclude</button>
      {api.dialogs}
    </>
  );
}

function openConfirm(): HTMLElement {
  const trigger = screen.getByRole('button', { name: 'open-exclude' });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole('dialog');
}

describe('X-6: подтверждение скрытия заметки доступно скринридеру', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('роль dialog, модальность и подпись из заголовка', () => {
    render(<Harness doc={{ localId: 'note_x6', hasLocal: true, hasCloud: false }} />);
    const dialog = openConfirm();

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId, 'у dialog нет aria-labelledby').toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe('ai_note_exclude_confirm');
    // Имя диалога = его заголовок, а не первая кнопка.
    expect(screen.getByRole('dialog', { name: 'ai_note_exclude_confirm' })).toBeInTheDocument();
  });

  it('кнопка подтверждения называется иначе, чем кнопка, открывшая подтверждение', () => {
    render(<Harness doc={{ localId: 'note_x6', hasLocal: true, hasCloud: false }} />);
    openConfirm();

    const dialog = screen.getByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'ai_note_exclude_confirm_action' });
    // Кнопка строки меню называется «ai_note_exclude» — внутри подтверждения
    // такого имени быть не должно, иначе скринридер читает две одинаковые кнопки.
    expect(within(dialog).queryAllByRole('button', { name: 'ai_note_exclude' })).toHaveLength(0);
    expect(confirmButton).toBeInTheDocument();
  });

  it('фокус уходит в диалог и возвращается на открывшую кнопку', () => {
    render(<Harness doc={{ localId: 'note_x6', hasLocal: true, hasCloud: false }} />);
    const trigger = screen.getByRole('button', { name: 'open-exclude' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const dialog = openConfirm();
    expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('подтверждение вызывает исключение, отмена — нет', async () => {
    render(<Harness doc={{ localId: 'note_x6', hasLocal: true, hasCloud: false }} />);
    openConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'ai_note_exclude_confirm_action' }));
    await waitFor(() => expect(exclusionOnClick).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'common_cancel' }));
    await waitFor(() => expect(exclusionOnClick).toHaveBeenCalledTimes(1));
  });
});
