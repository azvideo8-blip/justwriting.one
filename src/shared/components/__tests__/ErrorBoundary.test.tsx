import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary, isChunkLoadError } from '../ErrorBoundary';
import { reportError } from '../../errors/reportError';

vi.mock('../../errors/reportError', () => ({
  reportError: vi.fn(),
}));

function ThrowingComponent({ error }: { error: Error }): never {
  throw error;
}

describe('ERR-9: ErrorBoundary chunk load error detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('correctly identifies chunk load errors via isChunkLoadError', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module /assets/Foo.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read property of undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('renders generic error screen for regular runtime errors', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error('Normal component explosion')} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary-chunk')).not.toBeInTheDocument();
    expect(screen.getByText(/ERR-/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Повторить|Retry/i })).toBeInTheDocument();
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) })
    );
  });

  it('renders update banner without generic ERR-code or retry button on chunk load error', () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadMock },
    });

    render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error('Failed to fetch dynamically imported module /assets/SettingsPage-12345.js')} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('error-boundary-chunk')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument();
    expect(screen.queryByText(/ERR-/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Повторить|Retry/i })).not.toBeInTheDocument();

    const reloadBtn = screen.getByRole('button', { name: /Обновить страницу|Reload page/i });
    expect(reloadBtn).toBeInTheDocument();
    fireEvent.click(reloadBtn);
    expect(reloadMock).toHaveBeenCalled();

    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'chunk_load_failed' }),
      'warning'
    );
  });
});
