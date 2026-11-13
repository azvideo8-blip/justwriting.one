// TR-4: ленивая половина автозапуска — собирает условия и ждёт до минуты.
// Мутации (прогнаны, каждая красная):
//  1. статический импорт TourOverlay в AppShell → bootChunkGraph.n2 (TR-4);
//  2. countLocalNotes: `catch { return 0 }` → «подсчёт заметок бросил → тура нет»;
//  3. по истечении минуты писать `skipped:0` → «кэш политики пуст 61 с → отметки нет»;
//  4. countCloudNotes: `catch { return 0 }` → «облако не прочиталось → тура нет»;
//  5. ручной запуск без проверки окон (`quietMs >= 0`) → «событие при открытом окне».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EarlierQuestionOpenContext } from '../onboardingQueue';
import { TourAutoStart } from '../TourAutoStart';
import { useContentStore } from '../../features/writing/store/useContentStore';
import { useTimerStore } from '../../features/writing/store/useTimerStore';

const h = vi.hoisted(() => ({
  auth: { user: { uid: 'u1' } as { uid: string } | null, isGuest: false },
  local: vi.fn(),
  cloud: vi.fn(),
  vaultLocked: false,
}));
vi.mock('../../features/auth/hooks/useAuthStatus', () => ({ useAuthStatus: () => h.auth }));
vi.mock('../../core/services/LocalStorageService', () => ({ LocalStorageService: { getDocumentsByOwner: h.local } }));
vi.mock('../../core/services/cloudListPartial', () => ({ readCloudDocumentsPartial: h.cloud }));
vi.mock('../../core/services/rateGate', () => ({ withRateLimitRetry: (fn: () => unknown) => fn() }));
vi.mock('../../core/crypto/encrypt', () => ({ isVaultUnlocked: () => !h.vaultLocked }));
vi.mock('../../core/crypto/cryptoHelpers', () => ({ getEncryptionEnabled: () => h.vaultLocked }));
vi.mock('../../features/tour/TourOverlay', () => ({
  FOREIGN_DIALOG: '[role="dialog"]:not([data-tour-card]), [data-testid="first-run-stepper"]',
  TourOverlay: () => <div data-testid="tour-on" />,
}));

const onEnd = vi.fn();
function mount(opts: { manual?: boolean; queued?: boolean; path?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[opts.path ?? '/']}>
      <EarlierQuestionOpenContext.Provider value={opts.queued ?? false}>
        <TourAutoStart manual={opts.manual ?? false} onEnd={onEnd} />
      </EarlierQuestionOpenContext.Provider>
    </MemoryRouter>,
  );
}
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const tourOn = () => document.querySelector('[data-testid="tour-on"]') !== null;
const confirmFirstEntry = () => {
  localStorage.setItem('privacy_accepted_u1', '3');
  localStorage.setItem('auto_sync_asked_u1', 'true');
};

describe('TR-4: TourAutoStart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    onEnd.mockClear();
    h.auth = { user: { uid: 'u1' }, isGuest: false };
    h.vaultLocked = false;
    h.local.mockReset().mockResolvedValue([]);
    h.cloud.mockReset().mockResolvedValue({ docs: [], unreadable: [], uuids: [] });
    useContentStore.setState({ content: '' });
    useTimerStore.setState({ status: 'idle' });
    confirmFirstEntry();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('все условия выполнены → тур появился, отметку автозапуск не пишет', async () => {
    mount();
    await wait(1000);
    expect(tourOn()).toBe(false); // тишина короче 1,5 с
    await wait(2000);
    expect(tourOn()).toBe(true);
    expect(onEnd).not.toHaveBeenCalled();
    expect(localStorage.getItem('jw_tour_v1_u1')).toBeNull();
    expect(h.cloud).toHaveBeenCalledTimes(1);
  });

  it('кэш политики пуст 59 с, затем появился → тур появился', async () => {
    localStorage.removeItem('privacy_accepted_u1');
    mount();
    await wait(57_000);
    expect(tourOn()).toBe(false);
    expect(onEnd).not.toHaveBeenCalled();
    localStorage.setItem('privacy_accepted_u1', '3');
    await wait(2500);
    expect(tourOn()).toBe(true);
  });

  it('кэш политики пуст 61 с → тура нет, отметки нет', async () => {
    localStorage.removeItem('privacy_accepted_u1');
    mount();
    await wait(61_000);
    expect(tourOn()).toBe(false);
    expect(onEnd).toHaveBeenCalled();
    expect(localStorage.getItem('jw_tour_v1_u1')).toBeNull();
  });

  it('старая версия политики в кэше — не подтверждение', async () => {
    localStorage.setItem('privacy_accepted_u1', '2');
    mount();
    await wait(10_000);
    expect(tourOn()).toBe(false);
  });

  it('на вопрос о синхронизации не ответили → тура нет', async () => {
    localStorage.removeItem('auto_sync_asked_u1');
    mount();
    await wait(10_000);
    expect(tourOn()).toBe(false);
    localStorage.setItem('auto_sync_enabled_u1', 'false');
    await wait(1000);
    expect(tourOn()).toBe(true);
  });

  it('код восстановления ждёт показа → тура нет', async () => {
    sessionStorage.setItem('pending_recovery_code_u1', 'AAAA-BBBB');
    mount();
    await wait(10_000);
    expect(tourOn()).toBe(false);
  });

  it('очередь первого входа занята → тура нет', async () => {
    mount({ queued: true });
    await wait(10_000);
    expect(tourOn()).toBe(false);
  });

  it('на экране окно → тура нет; закрылось — ждём 1,5 с тишины', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    mount();
    await wait(10_000);
    expect(tourOn()).toBe(false);
    dialog.remove();
    await wait(1000);
    expect(tourOn()).toBe(false);
    await wait(1000);
    expect(tourOn()).toBe(true);
  });

  it('подсчёт заметок бросил ошибку → тура нет, отметки нет', async () => {
    h.local.mockRejectedValue(new Error('idb'));
    mount();
    await wait(61_000);
    expect(tourOn()).toBe(false);
    expect(localStorage.getItem('jw_tour_v1_u1')).toBeNull();
  });

  it('сейф заперт → заметки не посчитаны → тура нет', async () => {
    h.vaultLocked = true;
    mount();
    await wait(10_000);
    expect(tourOn()).toBe(false);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('облако не прочиталось → тура нет, отметки нет', async () => {
    h.cloud.mockRejectedValue(new Error('offline'));
    mount();
    await wait(61_000);
    expect(tourOn()).toBe(false);
    expect(localStorage.getItem('jw_tour_v1_u1')).toBeNull();
  });

  it('в облаке есть заметки (старый человек на новом устройстве) → тура нет, сразу конец', async () => {
    h.cloud.mockResolvedValue({ docs: [{ id: 'a' }], unreadable: [], uuids: [] });
    mount();
    await wait(5000);
    expect(tourOn()).toBe(false);
    expect(onEnd).toHaveBeenCalled();
  });

  it('на устройстве есть заметки → сразу конец, облако не читаем', async () => {
    h.local.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    mount();
    await wait(2000);
    expect(tourOn()).toBe(false);
    expect(onEnd).toHaveBeenCalled();
    expect(h.cloud).not.toHaveBeenCalled();
  });

  it('в поле уже есть текст или идёт сессия → тура нет', async () => {
    useContentStore.setState({ content: 'уже пишу' });
    mount();
    await wait(5000);
    expect(tourOn()).toBe(false);
    useContentStore.setState({ content: '' });
    useTimerStore.setState({ status: 'writing' });
    await wait(5000);
    expect(tourOn()).toBe(false);
  });

  it('не на экране письма → тура нет', async () => {
    mount({ path: '/archive' });
    await wait(5000);
    expect(tourOn()).toBe(false);
  });

  it('ручной запуск при отметке done и трёх заметках → тур появился', async () => {
    localStorage.setItem('jw_tour_v1_u1', 'done');
    h.local.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    mount({ manual: true, path: '/profile' });
    await wait(400);
    expect(tourOn()).toBe(true);
  });

  it('ручной запуск у гостя → тур появился', async () => {
    h.auth = { user: null, isGuest: true };
    mount({ manual: true });
    await wait(400);
    expect(tourOn()).toBe(true);
  });

  it('событие при открытом окне → тура нет', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    mount({ manual: true });
    await wait(4000);
    expect(tourOn()).toBe(false);
    expect(onEnd).toHaveBeenCalled();
  });

  it('ручной запуск ждёт, пока закроется окно настроек', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    mount({ manual: true });
    await wait(500);
    dialog.remove();
    await wait(500);
    expect(tourOn()).toBe(true);
  });
});
