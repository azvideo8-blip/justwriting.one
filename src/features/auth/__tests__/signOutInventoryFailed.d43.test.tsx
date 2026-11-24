// Подозрение дейлика 22.11: опись упала целиком — окно выхода рисовало пустоту и
// давало стереть без предупреждения; пока опись считалась — тоже.
// Мутации: «опись не пришла» = 0 неотправленных — красные все три первых;
// не сбрасывать опись при открытии — красный (числа прошлого открытия).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const h = vi.hoisted(() => ({ count: vi.fn(), user: { uid: 'u_d43' } }));
vi.mock('../hooks/useAuthStatus', () => ({ useAuthStatus: () => ({ user: h.user }) }));
vi.mock('../services/localDataInventory', () => ({ countLocalDataInventory: h.count }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { SignOutConfirmModal } from '../components/SignOutConfirmModal';
import { LanguageProvider } from '../../../shared/i18n';

const view = (open = true) => <LanguageProvider><SignOutConfirmModal open={open} onClose={vi.fn()} onConfirm={vi.fn()} /></LanguageProvider>;
const wipeBtn = () => screen.getByRole('button', { name: /Выйти и удалить всё/ }) as HTMLButtonElement;
const tick = () => fireEvent.click(screen.getByText('Это чужой компьютер — удалить все данные'));
const INV = {
  notesCount: 7, versionsCount: 7, hasPortrait: false, facetsCount: 0, dialoguesCount: 0, dialogueEventsCount: 0,
  chatMemoriesCount: 0, lifeStoryCount: 0, themeCount: 0, beliefsCount: 0, commitmentsCount: 0, digestsCount: 0,
  threadsCount: 0, personasCount: 0, unsyncedNotesCount: 0, guestEntriesCount: 0, totalItems: 14,
};

beforeEach(() => { h.count.mockReset(); });

describe('окно выхода: опись не посчиталась', () => {
  it('предупреждение и галочка есть, без галочки стереть нельзя', async () => {
    h.count.mockRejectedValue(new Error('idb stalled'));
    render(view()); tick();
    expect(await screen.findByText(/Не удалось проверить, всё ли отправлено/)).toBeTruthy();
    expect(wipeBtn().disabled).toBe(true);
    fireEvent.click(screen.getByText(/Я понимаю риски/));
    expect(wipeBtn().disabled).toBe(false);
  });

  it('пока считается — стереть нельзя', () => {
    h.count.mockReturnValue(new Promise(() => {}));
    render(view()); tick();
    expect(wipeBtn().disabled).toBe(true);
  });

  it('открыли снова, и опись упала — числа прошлого открытия не показаны', async () => {
    h.count.mockResolvedValueOnce(INV).mockRejectedValueOnce(new Error('idb stalled'));
    const v = render(view()); tick();
    expect((await screen.findAllByText('7', { selector: 'strong' })).length).toBe(2);
    await act(async () => { v.rerender(view(false)); });
    await act(async () => { v.rerender(view(true)); });
    tick();
    expect(await screen.findByText(/Не удалось проверить/)).toBeTruthy();
    expect(screen.queryByText('7', { selector: 'strong' })).toBeNull();
  });

  it('контроль: посчитано, неотправленного нет — стереть можно сразу', async () => {
    h.count.mockResolvedValue(INV);
    render(view()); tick();
    expect((await screen.findAllByText('7', { selector: 'strong' })).length).toBe(2);
    expect(wipeBtn().disabled).toBe(false);
  });

  // Мутация: в описи вернуть 0 из catch — счётчик покажет «0» (тест ниже).
  it('диалоги не посчитались — «не удалось посчитать», а не 0', async () => {
    h.count.mockResolvedValue({ ...INV, dialoguesCount: null });
    render(view()); tick();
    const row = await screen.findByText(/Диалогов/);
    expect(row.textContent).toContain('не удалось посчитать');
  });

  // Ревью 0.11.25 N-9: неотправленное появилось после подсчёта. Мутации: искать слово в тексте
  // ошибки — красный (английский текст на экране); не пересчитать — красный (галочки нет).
  it('выход отказал из-за неотправленного — по-русски, с пересчётом и галочкой', async () => {
    h.count.mockResolvedValueOnce(INV).mockResolvedValueOnce({ ...INV, unsyncedNotesCount: 1 });
    const err = Object.assign(new Error('Sign-out would destroy 1 unsynced item(s)'), { name: 'UnsyncedLocalDataError' });
    render(<LanguageProvider><SignOutConfirmModal open onClose={vi.fn()} onConfirm={vi.fn().mockRejectedValue(err)} /></LanguageProvider>);
    tick();
    expect((await screen.findAllByText('7', { selector: 'strong' })).length).toBe(2);
    fireEvent.click(wipeBtn());
    expect(await screen.findByText(/Есть несинхронизированные данные/)).toBeTruthy();
    expect(screen.queryByText(/Sign-out would destroy/)).toBeNull();
    expect(await screen.findByText(/Я понимаю риски/)).toBeTruthy();
  });

  // Мутация: всегда «есть несинхронизированные» — красный.
  it('выход отказал, потому что журнал не прочитался — «не удалось проверить», а не «есть»', async () => {
    h.count.mockResolvedValue(INV);
    const err = Object.assign(new Error('x'), { name: 'UnsyncedLocalDataError', data: { total: 0, ai: null } });
    render(<LanguageProvider><SignOutConfirmModal open onClose={vi.fn()} onConfirm={vi.fn().mockRejectedValue(err)} /></LanguageProvider>);
    tick();
    expect((await screen.findAllByText('7', { selector: 'strong' })).length).toBe(2);
    fireEvent.click(wipeBtn());
    expect(await screen.findByText(/Не удалось проверить, всё ли отправлено/)).toBeTruthy();
    expect(screen.queryByText(/Есть несинхронизированные данные/)).toBeNull();
  });
});
