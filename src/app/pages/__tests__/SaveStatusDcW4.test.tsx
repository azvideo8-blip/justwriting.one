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
vi.mock('../../../features/writing/components/BottomStats', () => ({ BottomStats: () => null }));
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

  it('показывает «Сохранено» при настройках по умолчанию', () => {
    state.saveStatus = 'saved';
    renderLayout();
    expect(screen.getByText(/Сохранено/)).toBeInTheDocument();
  });

  it('остаётся в документе в дзене', () => {
    state.saveStatus = 'saved';
    state.isZenActive = true;
    renderLayout();
    expect(screen.getByText(/Сохранено/)).toBeInTheDocument();
  });

  it('ошибка — всегда на полной яркости и цветом опасности', () => {
    state.saveStatus = 'error';
    state.saveErrorKind = 'quota';
    state.isZenActive = true;
    renderLayout();
    const el = screen.getByTestId('save-status');
    expect(el).toHaveTextContent('Недостаточно места на устройстве');
    expect(el.className).toContain('opacity-100');
    expect(el.className).toContain('text-accent-danger');
  });

  it('метка времени снимается в момент перехода в «Сохранено»', async () => {
    state.saveStatus = 'saving';
    const { rerender } = renderLayout();
    expect(screen.getByTestId('save-status').textContent).not.toMatch(/Сохранено/);

    state.saveStatus = 'saved';
    rerender(
      <LanguageProvider>
        <DesktopWritingLayout />
      </LanguageProvider>
    );
    await waitFor(
      () => {
        expect(screen.getByTestId('save-status').textContent).toMatch(/Сохранено · \d{1,2}[:.]\d{2}/);
      },
      { timeout: 3000 },
    );
  });

  it('вспышка на полной яркости гаснет через секунду', () => {
    vi.useFakeTimers();
    let tree: ReturnType<typeof renderLayout> | null = null;
    try {
      state.saveStatus = 'saving';
      tree = renderLayout();

      state.saveStatus = 'saved';
      tree.rerender(
        <LanguageProvider>
          <DesktopWritingLayout />
        </LanguageProvider>
      );
      expect(screen.getByTestId('save-status').className).toContain('opacity-100');

      act(() => { vi.advanceTimersByTime(1100); });
      const el = screen.getByTestId('save-status');
      expect(el.className).toContain('opacity-70');
      expect(el.className).not.toContain('opacity-100');
    } finally {
      if (tree !== null) tree.unmount();
      vi.useRealTimers();
    }
  });

  it('в простое статуса нет', () => {
    renderLayout();
    expect(screen.queryByTestId('save-status')).toBeNull();
  });
});
