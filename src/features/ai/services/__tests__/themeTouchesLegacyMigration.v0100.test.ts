// Ревью 0.10.0 (/code-review): R7F-020 перевёл очередь обязательных разборов тем
// на ключ по аккаунту и разово вливал прежний общий ключ — но удалял его, не
// записав слитый список. Чтение (getPendingThemeTouches) и «уже в очереди» при
// постановке теряли прежние записи: проход тем упал — заметки выпали навсегда.
// Мутация: убрать запись слитого списка → красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u1' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const { getPendingThemeTouches, enqueuePendingThemeTouch } = await import('../AIThemeLedgerService');

describe('очередь разборов тем: переезд прежнего общего ключа', () => {
  beforeEach(() => localStorage.clear());

  it('чтение переносит прежние записи в ключ аккаунта, а не теряет их', () => {
    localStorage.setItem('jw_pending_theme_touches', JSON.stringify(['d1', 'd2']));
    expect(getPendingThemeTouches()).toEqual(['d1', 'd2']);
    expect(localStorage.getItem('jw_pending_theme_touches')).toBeNull();
    expect(JSON.parse(localStorage.getItem('jw_pending_theme_touches_u1') ?? '[]')).toEqual(['d1', 'd2']);
  });

  it('постановка уже стоящего id не теряет прежние записи', () => {
    localStorage.setItem('jw_pending_theme_touches_u1', JSON.stringify(['d1']));
    localStorage.setItem('jw_pending_theme_touches', JSON.stringify(['d9']));
    enqueuePendingThemeTouch('d1');
    expect(JSON.parse(localStorage.getItem('jw_pending_theme_touches_u1') ?? '[]')).toEqual(['d1', 'd9']);
  });
});
