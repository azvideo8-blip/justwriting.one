import { describe, it, expect, vi } from 'vitest';
import { lazy, Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErrorBoundary } from '../../shared/components/ErrorBoundary';

vi.mock('../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

// Ревью приёмки 0.10.0: N-2 сделал ленивыми два куска, которые монтируются на
// КАЖДОМ старте (мост миграции гостя и панель настроек). Их единственной защитой
// был верхний ErrorBoundary — отказ загрузки куска на плохой сети закрывал всё
// приложение, редактор тоже, экраном «приложение обновилось».

describe('ленивые куски, смонтированные на старте', () => {
  it('отказ загрузки куска под fallback={null} не закрывает соседей', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/x.js')));
    render(
      <div>
        <p>editor</p>
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}><Broken /></Suspense>
        </ErrorBoundary>
      </div>,
    );
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(screen.getByText('editor')).toBeTruthy();
    expect(screen.queryByTestId('error-boundary-chunk')).toBeNull();
  });

  // Мутация: снять обёртку в AppShell или AppProviders → красный.
  it.each([
    ['AppShell.tsx', 'GuestMigrationGate'],
    ['AppProviders.tsx', 'SettingsPanel'],
  ])('%s: <%s /> стоит под своим ErrorBoundary', (file, component) => {
    const src = readFileSync(resolve(__dirname, '..', file), 'utf8');
    const re = new RegExp(`<ErrorBoundary fallback=\\{null\\}>\\s*<Suspense fallback=\\{null\\}>\\s*<${component}[\\s/]`);
    expect(src).toMatch(re);
  });
});
