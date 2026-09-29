// DC-W5: дзен не должен двигать текст по горизонтали и прятать кнопки шапки от
// клавиатуры. Проверка (2) — gridTemplateColumns не меняется; (3) — в дзене
// «Сохранить» смонтирован и фокус по нему возвращает интерфейс.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { DesktopWritingLayout } from '../DesktopWritingLayout';
import { WritingHeader } from '../../../features/writing/components/WritingHeader';
import { LanguageProvider } from '../../../shared/i18n';

const state = vi.hoisted(() => ({
  isZenActive: false,
  revealUICalls: 0,
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
    silenceMode: false,
    revealUI: () => { state.revealUICalls += 1; },
    setLifeLogVisible: vi.fn(),
    setLifeLogTab: vi.fn(),
    setLifeLogPinned: vi.fn(),
  }),
}));

vi.mock('../../../features/writing/contexts/WritingSessionContext', () => ({
  useWritingSessionContext: () => ({
    flow: { setupMode: false, setSetupMode: vi.fn(), startCountdown: vi.fn(), countdown: null, totalDurationForDeadline: null, sessionStartFlash: false },
    actions: { handleNew: vi.fn(), handleOpen: vi.fn(), handlePlay: vi.fn(), handlePause: vi.fn(), handleContinueDocument: vi.fn(), handleContinueSessionOrDoc: vi.fn() },
    session: { status: 'writing', hasDraft: false, userId: 'u1', saveStatus: 'idle', saveErrorKind: null, setTitle: vi.fn(), restoreDraft: vi.fn(), discardDraft: vi.fn() },
    streakDays: 1,
    handlePlayRef: { current: vi.fn() },
    keystrokeTrackerRef: { current: { record: vi.fn() } },
    showZen: state.isZenActive,
    onFinishClick: vi.fn(),
  }),
}));

vi.mock('../../../features/writing/components/WritingEditor', () => ({ WritingEditor: () => null }));
vi.mock('../../../features/writing/components/WritingSetup', () => ({ WritingSetup: () => null }));
vi.mock('../../../features/writing/components/LifeLogPanel', () => ({ LifeLogPanel: () => null }));
vi.mock('../../../features/writing/components/BottomStats', () => ({ BottomStats: () => null }));
vi.mock('../../../features/writing/components/SessionGlow', () => ({ SessionGlow: () => null }));
vi.mock('../../../features/writing/components/SaveStatus', () => ({ SaveStatus: () => null }));

const gridStyle = (): string => {
  const el = document.querySelector('[style*="grid-template-columns"]') as HTMLElement | null;
  return el?.style.gridTemplateColumns ?? '';
};

describe('DC-W5: дзен не двигает текст', () => {
  beforeEach(() => {
    state.isZenActive = false;
    state.revealUICalls = 0;
    if (typeof globalThis.ResizeObserver === 'undefined') {
      class Stub { observe() {} unobserve() {} disconnect() {} }
      globalThis.ResizeObserver = Stub as unknown as typeof ResizeObserver;
    }
  });

  const renderLayout = () => render(
    <LanguageProvider><DesktopWritingLayout /></LanguageProvider>
  );

  it('gridTemplateColumns одинаковый до и после дзена', () => {
    const { unmount } = renderLayout();
    const before = gridStyle();
    expect(before).toContain('64px');
    unmount();

    state.isZenActive = true;
    renderLayout();
    expect(gridStyle()).toBe(before);
    state.isZenActive = false;
  });

  it('в дзене шапка смонтирована, кнопка «Сохранить» доступна, фокус по ней показывает UI', () => {
    state.isZenActive = true;
    render(
      <LanguageProvider>
        <WritingHeader onSave={vi.fn()} onNew={vi.fn()} onOpenLog={vi.fn()} />
      </LanguageProvider>
    );

    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save).not.toBeDisabled();

    fireEvent.focus(save);
    expect(state.revealUICalls).toBe(1);
    state.isZenActive = false;
  });

  it('в простом режиме шапка видима и не ловит лишний reveal', () => {
    render(
      <LanguageProvider>
        <WritingHeader onSave={vi.fn()} onNew={vi.fn()} onOpenLog={vi.fn()} />
      </LanguageProvider>
    );
    const wrapper = screen.getByRole('button', { name: 'Сохранить' }).closest('div.w-full');
    act(() => { fireEvent.focus(screen.getByRole('button', { name: 'Сохранить' })); });
    expect(state.revealUICalls).toBe(0);
    expect(wrapper).toBeTruthy();
  });
});
