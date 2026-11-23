// PIN-1: DatabaseExplorer — отказ удаления записи назван error-тостом,
// а не зелёным «Запись удалена». Компонент настоящий, IndexedDB настоящий
// (fake-indexeddb); моки только края: подтверждение, отчёт об ошибках, auth.
// Мутация: убрать catch-тост удаления — красный а.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { DatabaseExplorer } from '../DatabaseExplorer';
import { getLocalDb, resetDbInstance } from '../../../../core/storage/localDb';

vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_admin' }) }));

const ERROR_TEXT = 'Ошибка при удалении записи';
const SUCCESS_TEXT = 'Запись удалена из IndexedDB';

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('language', 'ru');
  resetDbInstance();
  const db = await getLocalDb();
  await db.put('documents', {
    id: 'doc_pin6', title: 'Синтетическая заметка', guestId: 'u_admin', userId: 'u_admin',
    createdAt: 1, updatedAt: 1, currentVersion: 1, content: 'синтетика', wordCount: 1, tags: [], isPublic: false,
  } as never);
});
afterEach(cleanup);

function renderExplorer() {
  return renderWithProviders(
    <ToastProvider>
      <DatabaseExplorer userId="u_admin" />
    </ToastProvider>,
  );
}

async function selectRowAndDelete() {
  fireEvent.click(await screen.findByText('Синтетическая заметка'));
  fireEvent.click(screen.getByRole('button', { name: 'Удалить документ' }));
}

describe('PIN-1: удаление записи в DatabaseExplorer — отказ назван', () => {
  it('PIN-1: delete бросил — error-тост, не зелёный успех', async () => {
    const db = await getLocalDb();
    const orig = db.delete.bind(db) as (store: string, key: string | number) => Promise<void>;
    (db as unknown as { delete: (store: string, key: string | number) => Promise<void> }).delete =
      (store, key) => store === 'documents' ? Promise.reject(new Error('SYNTHETIC_IDB_DOWN')) : orig(store, key);

    renderExplorer();
    await selectRowAndDelete();

    await waitFor(() => expect(screen.getByText(ERROR_TEXT)).toBeTruthy());
    expect(screen.queryByText(SUCCESS_TEXT)).toBeNull();
  });

  it('PIN-1 контроль: удаление прошло — зелёный тост как раньше', async () => {
    renderExplorer();
    await selectRowAndDelete();

    await waitFor(() => expect(screen.getByText(SUCCESS_TEXT)).toBeTruthy());
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  });
});