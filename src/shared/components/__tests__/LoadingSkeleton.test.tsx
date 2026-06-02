import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { renderWithProviders } from '../../../test/utils/render';

describe('LoadingSkeleton', () => {
  it('renders with role progressbar', () => {
    renderWithProviders(<LoadingSkeleton />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders default 3 lines', () => {
    const { container } = renderWithProviders(<LoadingSkeleton />);
    const lines = container.querySelectorAll('.animate-pulse');
    expect(lines.length).toBe(3);
  });

  it('renders custom number of lines', () => {
    const { container } = renderWithProviders(<LoadingSkeleton lines={5} />);
    const lines = container.querySelectorAll('.animate-pulse');
    expect(lines.length).toBe(5);
  });

  it('has aria-busy true', () => {
    renderWithProviders(<LoadingSkeleton />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-busy', 'true');
  });

  it('uses custom label when provided', () => {
    renderWithProviders(<LoadingSkeleton label="Loading data" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Loading data');
  });

  it('uses default label when no label prop', () => {
    renderWithProviders(<LoadingSkeleton />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Загрузка...');
  });

  it('accepts custom className', () => {
    renderWithProviders(<LoadingSkeleton className="skeleton-custom" />);
    expect(screen.getByRole('progressbar')).toHaveClass('skeleton-custom');
  });
});
