import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { JustWritingLogo } from '../JustWritingLogo';
import { renderWithProviders } from '../../../test/utils/render';

describe('JustWritingLogo', () => {
  it('renders an svg with role img', () => {
    renderWithProviders(<JustWritingLogo />);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('has aria-label from translation', () => {
    renderWithProviders(<JustWritingLogo />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'justwriting');
  });

  it('uses default size of 32', () => {
    renderWithProviders(<JustWritingLogo />);
    const svg = screen.getByRole('img');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
  });

  it('accepts custom size', () => {
    renderWithProviders(<JustWritingLogo size={64} />);
    const svg = screen.getByRole('img');
    expect(svg).toHaveAttribute('width', '64');
    expect(svg).toHaveAttribute('height', '64');
  });

  it('accepts custom className', () => {
    renderWithProviders(<JustWritingLogo className="custom-logo" />);
    expect(screen.getByRole('img')).toHaveClass('custom-logo');
  });

  it('renders with all decorative elements by default', () => {
    const { container } = renderWithProviders(<JustWritingLogo />);
    const textElements = container.querySelectorAll('text');
    expect(textElements.length).toBeGreaterThanOrEqual(5);
  });

  it('hides railway when showRailway is false', () => {
    const { container } = renderWithProviders(<JustWritingLogo showRailway={false} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(0);
  });

  it('hides roman numerals when showRoman is false', () => {
    const { container } = renderWithProviders(<JustWritingLogo showRoman={false} />);
    const textElements = container.querySelectorAll('text');
    const romanTexts = Array.from(textElements).filter(
      (t) => t.textContent === 'XII' || t.textContent === 'III' || t.textContent === 'VI' || t.textContent === 'IX'
    );
    expect(romanTexts.length).toBe(0);
  });

  it('hides crown when showCrown is false', () => {
    const { container } = renderWithProviders(<JustWritingLogo showCrown={false} />);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(0);
  });
});
