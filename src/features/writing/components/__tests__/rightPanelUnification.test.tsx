import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { WritingSettingsProvider, useWritingSettings } from '../../../../core/settings/WritingSettingsContext';
import { WritingHeader } from '../WritingHeader';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../../../navigation/components/Sidebar';
import { useActivityLogStore } from '../../../../shared/activity/useActivityLogStore';
import { WritingEditor } from '../WritingEditor';

import { ToastProvider } from '../../../../shared/components/Toast';

// Mock language hook
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
    tp: (k: string) => k,
    language: 'ru',
  }),
}));

describe('Right Panel Unification (AG-RIGHT-PANEL)', () => {
  beforeEach(() => {
    localStorage.clear();
    useActivityLogStore.getState().clearLog();
    useActivityLogStore.getState().setPanelOpen(false);
    vi.clearAllMocks();
  });

  it('dismissRightPanel closes panel when not attaching, but preserves panel when isAttachmentActive is true', () => {
    const { result } = renderHook(() => useWritingSettings(), {
      wrapper: ({ children }) => <WritingSettingsProvider>{children}</WritingSettingsProvider>,
    });

    // Open panel
    act(() => {
      result.current.setLifeLogTab('ai');
      result.current.setLifeLogVisible(true);
    });
    expect(result.current.lifeLogVisible).toBe(true);

    // When attachment is active, dismissRightPanel with ignoreIfAttaching should NOT close
    act(() => {
      result.current.setIsAttachmentActive(true);
    });
    act(() => {
      result.current.dismissRightPanel({ ignoreIfAttaching: true });
    });
    expect(result.current.lifeLogVisible).toBe(true);

    // When attachment is inactive, dismissRightPanel closes the panel
    act(() => {
      result.current.setIsAttachmentActive(false);
    });
    act(() => {
      result.current.dismissRightPanel({ ignoreIfAttaching: true });
    });
    expect(result.current.lifeLogVisible).toBe(false);
  });

  it('WritingHeader renders three distinct buttons that switch tabs and toggle panel', () => {
    const TestComponent = () => {
      const { lifeLogVisible, lifeLogTab } = useWritingSettings();
      return (
        <div>
          <div data-testid="panel-state">
            {lifeLogVisible ? `open-${lifeLogTab}` : 'closed'}
          </div>
          <WritingHeader />
        </div>
      );
    };

    render(
      <WritingSettingsProvider>
        <TestComponent />
      </WritingSettingsProvider>
    );

    expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');

    // Find the 3 buttons
    const logBtn = screen.getByLabelText('lifelog_tab_log');
    const aiBtn = screen.getByLabelText('lifelog_tab_ai');
    const settingsBtn = screen.getByLabelText('lifelog_tab_settings');

    expect(logBtn).toBeInTheDocument();
    expect(aiBtn).toBeInTheDocument();
    expect(settingsBtn).toBeInTheDocument();

    // 1. Click Log button -> opens panel on 'log' tab
    fireEvent.click(logBtn);
    expect(screen.getByTestId('panel-state')).toHaveTextContent('open-log');

    // 2. Click AI button -> switches panel to 'ai' tab
    fireEvent.click(aiBtn);
    expect(screen.getByTestId('panel-state')).toHaveTextContent('open-ai');

    // 3. Click Settings button -> switches panel to 'settings' tab
    fireEvent.click(settingsBtn);
    expect(screen.getByTestId('panel-state')).toHaveTextContent('open-settings');

    // 4. Click active Settings button again -> closes panel
    fireEvent.click(settingsBtn);
    expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');
  });

  it('clicking activity / error log in Sidebar calls dismissRightPanel to close the right panel', () => {
    // Add an activity error entry so the badge shows
    useActivityLogStore.getState().addError(new Error('Test error'), { source: 'test' });

    const TestContainer = () => {
      const { lifeLogVisible, setLifeLogVisible, lifeLogTab } = useWritingSettings();
      return (
        <MemoryRouter>
          <div data-testid="panel-visible">{lifeLogVisible ? `open-${lifeLogTab}` : 'closed'}</div>
          <button onClick={() => setLifeLogVisible(true)} data-testid="open-btn">Open Panel</button>
          <Sidebar isAdmin={false} />
        </MemoryRouter>
      );
    };

    render(
      <WritingSettingsProvider>
        <TestContainer />
      </WritingSettingsProvider>
    );

    // Open right panel
    fireEvent.click(screen.getByTestId('open-btn'));
    expect(screen.getByTestId('panel-visible')).toHaveTextContent('open-log');

    // Click the error log badge in Sidebar
    const badgeBtn = screen.getByTitle(/ошибка|ошибки|ошибок|activity_errors/);
    fireEvent.click(badgeBtn);

    // Right panel should now be closed, and activity log panel opened
    expect(screen.getByTestId('panel-visible')).toHaveTextContent('closed');
    expect(useActivityLogStore.getState().panelOpen).toBe(true);
  });

  it('clicking inside WritingEditor closes unpinned right panel, but drag selection does not', () => {
    const TestEditorWrapper = () => {
      const { lifeLogVisible, setLifeLogVisible, lifeLogTab } = useWritingSettings();
      return (
        <div>
          <div data-testid="panel-status">{lifeLogVisible ? `open-${lifeLogTab}` : 'closed'}</div>
          <button onClick={() => setLifeLogVisible(true)} data-testid="open-panel-btn">Open</button>
          <WritingEditor />
        </div>
      );
    };

    render(
      <ToastProvider>
        <WritingSettingsProvider>
          <TestEditorWrapper />
        </WritingSettingsProvider>
      </ToastProvider>
    );

    // Open panel
    fireEvent.click(screen.getByTestId('open-panel-btn'));
    expect(screen.getByTestId('panel-status')).toHaveTextContent('open-log');

    const textarea = screen.getByLabelText('writing_placeholder');

    // Simulate drag selection (pointer down at x=100, pointer up at x=300 -> distance > 6px)
    fireEvent.pointerDown(textarea, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(textarea, { clientX: 300, clientY: 100 });
    // Panel should NOT close on drag
    expect(screen.getByTestId('panel-status')).toHaveTextContent('open-log');

    // Simulate simple click (pointer down at x=100, pointer up at x=101 -> distance < 6px)
    fireEvent.pointerDown(textarea, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(textarea, { clientX: 101, clientY: 100 });
    // Panel should close on simple click
    expect(screen.getByTestId('panel-status')).toHaveTextContent('closed');
  });
});
