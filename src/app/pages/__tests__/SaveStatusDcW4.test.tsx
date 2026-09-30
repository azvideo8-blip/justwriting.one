// DC-W4: статус сохранения должен доходить до писателя при настройках по
// умолчанию (журнал включён → шапки нет) и в дзен (шапка размонтирована).
// Раньше «Сохранено» жил только в шапке и в этих двух случаях исчезал.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { DesktopWritingLayout } from '../DesktopWritingLayout';
import { LanguageProvider } from '../../../shared/i18n';

const state = vi.hoisted(() => ({
  saveStatus: 'idle' as 'idle' | 'saving' | 'saved' | 'cloud-stale' | 'error',
  saveErrorKind: null as 'quota' | 'unknown' | null,
  isZenActive: false,
}));

vi.mock('../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    editorWidth: 68,
    zenSeenOnce: true,
    isZenActive: state.isZenActive,
    zenModeEnabled: true,
    lifeLogEnabled: true,
    lifeLogVisible: false,
    lifeLogPinned: false,
    lifeLogTab: 'log',
    setLifeLogVisible: vi.fn(),
    setLifeLogTab: vi.fn(),
    setLifeLogPinned: vi.fn(),
  }),
}));

vi.mock('../../../features/writing/contexts/WritingSessionContext', () => ({
  useWritingSessionContext: () => ({
    flow: {
      setupMode: false,
      setSetupMode: vi.fn(),
      startCountdown: vi.fn(),
      countdown: null,
      totalDurationForDeadline: null,
      sessionStartFlash: false,
    },
    actions: {
      handleNew: vi.fn(),
      handleOpen: vi.fn(),
      handlePlay: vi.fn(),
      handlePause: vi.fn(),
      handleContinueDocument: vi.fn(),
      handleContinueSessionOrDoc: vi.fn(),
    },
    session: {
      status: 'writing',
      hasDraft: false,
      userId: 'u1',
      saveStatus: state.saveStatus,
      saveErrorKind: state.saveErrorKind,
      setTitle: vi.fn(),
      restoreDraft: vi.fn(),
      discardDraft: vi.fn(),
    },
    streakDays: 1,
    handlePlayRef: { current: vi.fn() },
    keystrokeTrackerRef: { current: { record: vi.fn() } },
    showZen: state.isZenActive,
    onFinishClick: vi.fn(),
  }),
}));

vi.mock('../../../features/writing/components/WritingHeader', () => ({ WritingHeader: () => null }));
vi.mock('../../../features/writing/components/WritingEditor', () => ({ WritingEditor: () => null }));
vi.mock('../../../features/writing/components/WritingSetup', () => ({ WritingSetup: () => null }));
vi.mock('../../../features/writing/components/LifeLogPanel', () => ({ LifeLogPanel: () => null }));
// Дискета живёт в панели кнопок: мок панели рисует только её, из тех же пропсов.
vi.mock('../../../features/writing/components/BottomStats', async () => {
  const { SaveStatus } = await import('../../../features/writing/components/SaveStatus');
  return {
    BottomStats: (p: { saveStatus?: 'idle' | 'saving' | 'saved' | 'cloud-stale' | 'error'; saveErrorKind?: 'quota' | 'unknown' | null }) =>
      <SaveStatus saveStatus={p.saveStatus ?? 'idle'} saveErrorKind={p.saveErrorKind ?? null} />,
  };
});
vi.mock('../../../features/writing/components/SessionGlow', () => ({ SessionGlow: () => null }));

describe('DC-W4: SaveStatus на экране письма', () => {
  beforeEach(() => {
    state.saveStatus = 'idle';
    state.saveErrorKind = null;
    state.isZenActive = false;
    if (typeof globalThis.ResizeObserver === 'undefined') {
      class Stub { observe() {} unobserve() {} disconnect() {} }
      globalThis.ResizeObserver = Stub as unknown as typeof ResizeObserver;
    }
  });

  const renderLayout = () => render(
    <LanguageProvider>
      <DesktopWritingLayout />
    </LanguageProvider>
  );

  const rerenderLayout = (tree: ReturnType<typeof renderLayout>) => tree.rerender(
    <LanguageProvider>
      <DesktopWritingLayout />
    </LanguageProvider>
  );

  // Дискета в панели кнопок вместо надписей: почти прозрачна, на сохранении загорается и гаснет,
  // время — в подсказке. Ошибка — всегда видна и цветом, и голосом.
  it('иконка есть всегда, даже до первого сохранения', () => {
    renderLayout();
    expect(screen.getByTestId('save-status')).toHaveAttribute('aria-label', 'Ещё не сохранялось');
  });

  it('остаётся в документе в дзене', () => {
    state.saveStatus = 'saved';
    state.isZenActive = true;
    renderLayout();
    expect(screen.getByTestId('save-status')).toBeInTheDocument();
  });

  it('подсказка называет время сохранения', async () => {
    state.saveStatus = 'saving';
    const tree = renderLayout();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Сохранение');

    state.saveStatus = 'saved';
    rerenderLayout(tree);
    await waitFor(() => {
      expect(screen.getByRole('tooltip').textContent).toMatch(/Сохранено в \d{1,2}[:.]\d{2}/);
    });
    expect(screen.queryByText(/^Сохранено$/)).toBeNull();
  });

  it('загорается на сохранении и плавно гаснет после', () => {
    vi.useFakeTimers();
    let tree: ReturnType<typeof renderLayout> | null = null;
    try {
      state.saveStatus = 'saving';
      tree = renderLayout();
      expect(screen.getByTestId('save-status')).toHaveAttribute('data-lit', 'true');
      expect(screen.getByTestId('save-status').className).toContain('text-brand-soft');

      state.saveStatus = 'saved';
      rerenderLayout(tree);
      // Короткое сохранение не должно мигнуть незаметно — свет держится.
      act(() => { vi.advanceTimersByTime(400); });
      expect(screen.getByTestId('save-status')).toHaveAttribute('data-lit', 'true');

      act(() => { vi.advanceTimersByTime(700); });
      const el = screen.getByTestId('save-status');
      expect(el).not.toHaveAttribute('data-lit');
      expect(el.className).toContain('opacity-30');
    } finally {
      if (tree !== null) tree.unmount();
      vi.useRealTimers();
    }
  });

  it('ошибка — на полной яркости, цветом опасности и вслух', () => {
    state.saveStatus = 'error';
    state.saveErrorKind = 'quota';
    state.isZenActive = true;
    renderLayout();
    const el = screen.getByTestId('save-status');
    expect(el).toHaveAttribute('aria-label', 'Недостаточно места на устройстве');
    expect(el.className).toContain('opacity-100');
    expect(el.className).toContain('text-accent-danger');
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Недостаточно места на устройстве');
  });

  it('обычное сохранение вслух не объявляется', () => {
    state.saveStatus = 'saved';
    renderLayout();
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('');
  });
});
