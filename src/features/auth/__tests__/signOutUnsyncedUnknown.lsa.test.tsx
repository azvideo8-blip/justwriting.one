// 0.11.22: подсчёт неотправленного упал — окно выхода показывало «0» и прятало
// предупреждение с галочкой «стереть всё равно». Стирание само перепроверяет
// (AuthService.signOut) и при отказе подсчёта не стирает, но человеку из окна
// было нечем подтвердить. Мутации: вернуть 0 в catch инвентаря — красный;
// условие блока предупреждения только `> 0` — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { render, screen, fireEvent } from '@testing-library/react';

const authStub = vi.hoisted(() => ({ user: { uid: 'u_lsa_signout' } }));
vi.mock('../hooks/useAuthStatus', () => ({ useAuthStatus: () => authStub }));
vi.mock('../services/unsyncedLocalData', async (orig) => ({
  ...(await orig<object>()),
  countUnsyncedLocalData: vi.fn(async () => { throw new Error('idb stalled'); }),
}));

import { resetDbInstance } from '../../../core/storage/localDb';
import { countLocalDataInventory } from '../services/localDataInventory';
import { SignOutConfirmModal } from '../components/SignOutConfirmModal';
import { LanguageProvider } from '../../../shared/i18n';

beforeEach(() => {
  localStorage.clear();
  resetDbInstance();
});

describe('выход: «не удалось проверить» ≠ «всё отправлено»', () => {
  it('инвентарь: сбой подсчёта неотправленного — null, а не 0', async () => {
    const inv = await countLocalDataInventory('u_lsa_signout');
    expect(inv.unsyncedNotesCount).toBeNull();
  });

  it('окно: предупреждение «не удалось проверить» и галочка «стереть всё равно»', async () => {
    render(<LanguageProvider><SignOutConfirmModal open onClose={vi.fn()} onConfirm={vi.fn()} /></LanguageProvider>);
    fireEvent.click(screen.getByText('Это чужой компьютер — удалить все данные'));
    expect(await screen.findByText(/Не удалось проверить, всё ли отправлено/)).toBeTruthy();
    expect(screen.getByText('Я понимаю риски и хочу удалить данные без отправки в облако')).toBeTruthy();
    // Ревью 0.11.22: «не знаю» — как «есть неотправленное»: без галочки стереть нельзя.
    // Мутация: вернуть `(… ?? 0) > 0` в disabled кнопки — красный.
    const wipe = screen.getByRole('button', { name: /Выйти и удалить всё/ }) as HTMLButtonElement;
    expect(wipe.disabled).toBe(true);
    fireEvent.click(screen.getByText('Я понимаю риски и хочу удалить данные без отправки в облако'));
    expect(wipe.disabled).toBe(false);
  });
});
