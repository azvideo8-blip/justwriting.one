// MQ-10: нижняя панель вкладок непрозрачна — под подписями не просвечивает страница.
// Фон — `--surface-popup`, непрозрачный слот во всех четырёх темах (после MF-20).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { BottomNav } from '../BottomNav';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k }),
}));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isGuest: false, user: { uid: 'u1' } }) }));
vi.mock('../../../../app/useLoginModal', () => ({ useLoginModal: () => ({ openLoginModal: vi.fn() }) }));
vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({ status: 'synced', pendingCount: 0, aiStorePendingCount: 0, aiStoreDeadCount: 0 }),
}));
vi.mock('../../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: (cb: (s: { entries: unknown[]; setPanelOpen: (v: boolean) => void }) => unknown) =>
    cb({ entries: [], setPanelOpen: vi.fn() }),
}));

describe('MQ-10: нижняя панель непрозрачна', () => {
  it('фон панели — непрозрачный слот, а не surface-card/85', () => {
    render(<MemoryRouter initialEntries={['/']}><BottomNav /></MemoryRouter>);
    const nav = screen.getByTestId('mobile-bottom-nav');
    expect(nav.className).toContain('bg-surface-popup');
    expect(nav.className).not.toMatch(/bg-surface-card|\/85/);
  });

  it('--surface-popup непрозрачен во всех четырёх темах (6-значный hex)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const values = [...css.matchAll(/--surface-popup:\s*([^;]+);/g)].map(m => m[1]!.trim());
    expect(values.length).toBeGreaterThanOrEqual(4);
    for (const v of values) expect(v, `--surface-popup: ${v}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
