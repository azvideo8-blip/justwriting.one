// N1-1 (дейлик 01.11, Н-1): счёт «Будет удалено с этого устройства…» считал
// только базу аккаунта (`unsyncedLocalData.ts` / `localDataInventory.ts`), поэтому
// гостевые строки общей базы, которые человек собирался стереть вместе с ними,
// ему не показывались. Диалог обещал «удалить все данные», а называл половину.
// Мутация: вернуть прежний инвентарь без гостевого счёта → оба теста красные.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { getLocalDb, resetDbInstance } from '../../../core/storage/localDb';
import { countLocalDataInventory } from '../services/localDataInventory';
import { SignOutConfirmModal } from '../components/SignOutConfirmModal';
import { LanguageProvider } from '../../../shared/i18n';

const USER = 'u_n1_inventory';
const GUEST_ID = 'guest_marker_n1';

// Объект стуба стабилен: свежий `{ user: … }` на каждый рендер заставляет
// эффект диалога (deps `[open, user]`) пересчитывать инвентарь без конца.
const authStub = vi.hoisted(() => ({ user: { uid: 'u_n1_inventory' } }));

vi.mock('../hooks/useAuthStatus', () => ({
  useAuthStatus: () => authStub,
}));

async function dropDatabases(): Promise<void> {
  resetDbInstance();
  for (const name of ['justwriting-local', `justwriting-local-${USER}`]) {
    await new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
}

/** 2 заметки + 1 версия + 1 черновик гостя = 4 записи без входа. */
async function seedGuestEntries(): Promise<void> {
  const shared = await getLocalDb('justwriting-local');
  await shared.put('documents', { id: 'gd_1', guestId: GUEST_ID, title: 'MARKER_N1_TITLE_1', currentVersion: 1 } as never);
  await shared.put('documents', { id: 'gd_2', guestId: GUEST_ID, title: 'MARKER_N1_TITLE_2', currentVersion: 1 } as never);
  await shared.put('versions', { id: 'gv_1', documentId: 'gd_1', guestId: GUEST_ID, version: 1, content: 'MARKER_N1_TEXT' } as never);
  await shared.put('drafts', { userId: GUEST_ID, title: 'MARKER_N1_DRAFT', content: 'текст', updatedAt: 1 } as never);
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await dropDatabases();
});

describe('N1-1: гостевые записи видны в инвентаре выхода', () => {
  it('countLocalDataInventory считает гостевые строки общей базы', async () => {
    await seedGuestEntries();

    const inv = await countLocalDataInventory(USER);

    expect(inv.guestEntriesCount).toBe(4);
    expect(inv.notesCount, 'гостевое затесалось в счёт заметок этого аккаунта').toBe(0);
  });

  it('без гостевых строк отдельной строки в диалоге нет', async () => {
    const inv = await countLocalDataInventory(USER);
    expect(inv.guestEntriesCount).toBe(0);

    render(<LanguageProvider><SignOutConfirmModal open onClose={vi.fn()} onConfirm={vi.fn()} /></LanguageProvider>);
    fireEvent.click(screen.getByText('Это чужой компьютер — удалить все данные'));

    await waitFor(() => expect(screen.getByText('Заметок:')).toBeDefined());
    expect(screen.queryByText('Записи без входа:')).toBeNull();
  });

  // Ревью 0.11.3: сбой чтения общей базы — не «гостевого нет»: выход их всё
  // равно сотрёт. Мутация: вернуть 0 при сбое (catch в countGuestEntriesInSharedDb
  // или начальное 0 в инвентаре) → красный.
  it('не прочиталось — счёт null и строка «не удалось посчитать», а не скрыта', async () => {
    await seedGuestEntries();
    const shared = await getLocalDb('justwriting-local');
    // Счёт идёт курсором в транзакции (дейлик 03.11 Н-3) — сбой ставим на неё.
    const spy = vi.spyOn(shared, 'transaction').mockImplementation(() => { throw new Error('idb stalled'); });
    try {
      const inv = await countLocalDataInventory(USER);
      expect(inv.guestEntriesCount).toBeNull();

      render(<LanguageProvider><SignOutConfirmModal open onClose={vi.fn()} onConfirm={vi.fn()} /></LanguageProvider>);
      fireEvent.click(screen.getByText('Это чужой компьютер — удалить все данные'));
      const label = await screen.findByText('Записи без входа:');
      expect(label.parentElement?.textContent).toContain('не удалось посчитать');
    } finally {
      spy.mockRestore();
    }
  });

  it('диалог с галочкой показывает «Записи без входа: 4»', async () => {
    await seedGuestEntries();

    render(<LanguageProvider><SignOutConfirmModal open onClose={vi.fn()} onConfirm={vi.fn()} /></LanguageProvider>);
    fireEvent.click(screen.getByText('Это чужой компьютер — удалить все данные'));

    const label = await screen.findByText('Записи без входа:');
    expect(label.parentElement?.textContent).toContain('4');
  });
});
