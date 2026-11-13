// TR-1: условия автозапуска знакомства. Главный риск пакета — тур поверх окна
// первого входа из-за «нет ответа ≠ окна не нужны».
// Мутации (прогнаны, каждая красная):
//  1. убрать `i.privacyConfirmed` → «privacyConfirmed нарушено → wait» и «кэш политики пуст → wait»;
//  2. `i.noteCount === 0` → `!i.noteCount` → «заметки не посчитаны (null) → wait»;
//  3. убрать `!i.queued` → «queued нарушено → wait»;
//  4. убрать `jw_tour_v1_` из accountScopedLocalStorageKeys → accountScopedKeys.inventory.test.
import { describe, it, expect } from 'vitest';
import { canAutoStart, type TourGateInput } from '../tourGate';

const ok: TourGateInput = {
  signedIn: true, isGuest: false, path: '/', tourState: null,
  privacyConfirmed: true, syncAnswered: true, recoveryCodePending: false, queued: false,
  dialogQuietMs: 1500, noteCount: 0, cloudCount: 0, editorEmpty: true, sessionIdle: true,
};

describe('TR-1: canAutoStart', () => {
  it('все условия выполнены → start', () => {
    expect(canAutoStart(ok)).toBe('start');
  });

  const broken: [string, Partial<TourGateInput>, 'wait' | 'never'][] = [
    ['signedIn', { signedIn: false }, 'never'],
    ['isGuest', { isGuest: true }, 'never'],
    ['path', { path: '/archive' }, 'wait'],
    ['tourState done', { tourState: 'done' }, 'never'],
    ['tourState skipped', { tourState: 'skipped:2' }, 'never'],
    ['privacyConfirmed', { privacyConfirmed: false }, 'wait'],
    ['syncAnswered', { syncAnswered: false }, 'wait'],
    ['recoveryCodePending', { recoveryCodePending: true }, 'wait'],
    ['queued', { queued: true }, 'wait'],
    ['dialogQuietMs', { dialogQuietMs: 1499 }, 'wait'],
    ['noteCount > 0', { noteCount: 3 }, 'never'],
    ['cloudCount > 0', { cloudCount: 12 }, 'never'],
    ['editorEmpty', { editorEmpty: false }, 'wait'],
    ['sessionIdle', { sessionIdle: false }, 'wait'],
  ];
  it.each(broken)('%s нарушено → %s, не start', (_name, patch, expected) => {
    expect(canAutoStart({ ...ok, ...patch })).toBe(expected);
  });

  // «Нет ответа» — три отдельных случая: ждать, а не стартовать и не сдаваться.
  it('заметки не посчитаны (null) → wait', () => {
    expect(canAutoStart({ ...ok, noteCount: null })).toBe('wait');
  });
  // Мутация: убрать `i.cloudCount === 0` → красный.
  it('облако не прочитано (null) → wait', () => {
    expect(canAutoStart({ ...ok, cloudCount: null })).toBe('wait');
  });
  it('хранилище отметки не ответило → wait', () => {
    expect(canAutoStart({ ...ok, tourState: 'unknown' })).toBe('wait');
  });
  it('кэш политики пуст (профиль ещё читается) → wait', () => {
    expect(canAutoStart({ ...ok, privacyConfirmed: false, queued: false, dialogQuietMs: 60_000 })).toBe('wait');
  });
});
