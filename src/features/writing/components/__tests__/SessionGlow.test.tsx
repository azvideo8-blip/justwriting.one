import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { SessionGlow } from '../SessionGlow';

vi.mock('motion/react', async () => {
  const actual = await vi.importActual<typeof import('motion/react')>('motion/react');
  return { ...actual, useReducedMotion: () => false };
});

const writingPage = readFileSync(
  resolve(__dirname, '../../../../app/pages/WritingPage.tsx'),
  'utf8'
);

describe('DC-W1: session start glow', () => {
  it('overlay exists while the session runs', () => {
    render(<SessionGlow phase="ring" />);
    expect(screen.getByTestId('session-glow')).toBeInTheDocument();
  });

  it('breath phase also renders the overlay', () => {
    render(<SessionGlow phase="breath" />);
    expect(screen.getByTestId('session-glow')).toBeInTheDocument();
  });

  it('the full-screen flash is gone from WritingPage', () => {
    expect(writingPage).not.toContain('sessionStartFlash &&');
    expect(writingPage).not.toContain('z-[var(--z-auth)]');
  });

  it('overlay ignores pointer events', () => {
    render(<SessionGlow phase="ring" />);
    const el = screen.getByTestId('session-glow');
    expect(el.className).toContain('pointer-events-none');
  });
});
