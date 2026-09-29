import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ImportDropOverlay } from '../ImportDropOverlay';

const { reduced } = vi.hoisted(() => ({ reduced: { current: false } }));

vi.mock('motion/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('motion/react')>();
  return { ...mod, useReducedMotion: () => reduced.current };
});

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'ru' }),
}));

const noop = () => undefined;

function renderOverlay(): HTMLElement {
  const { container } = render(
    <ImportDropOverlay
      onDragEnter={noop}
      onDragOver={noop}
      onDragLeave={noop}
      onDrop={noop}
    />
  );
  const el = container.firstElementChild;
  if (el === null) throw new Error('оверлей не отрендерился');
  return el as HTMLElement;
}

describe('DC-A6 зона импорта без прыгающей иконки', () => {
  beforeEach(() => {
    reduced.current = false;
  });

  afterEach(() => {
    cleanupDom();
  });

  function cleanupDom() {
    document.body.innerHTML = '';
  }

  it('никаких animate-классов: иконка статична', () => {
    const overlay = renderOverlay();
    expect(overlay.className).not.toMatch(/animate-/);
    expect(overlay.querySelectorAll('[class*="animate-"]')).toHaveLength(0);
  });

  it('пунктирная рамка бренда и тексты остались', () => {
    const overlay = renderOverlay();
    expect(overlay.className).toContain('border-dashed');
    expect(overlay.className).toContain('border-brand-soft');
    expect(overlay.textContent).toContain('archive_import_drop_title');
    expect(overlay.textContent).toContain('archive_import_drop_hint');
  });

  it('обычный режим: оверлей стартует невидимым и доезжает до opacity 1 (фейд)', async () => {
    const overlay = renderOverlay();
    expect(overlay.style.opacity).toBe('0');
    await waitFor(() => {
      expect(overlay.style.opacity).toBe('1');
    });
  });

  it('prefers-reduced-motion: оверлей сразу видим, без фейда', () => {
    reduced.current = true;
    const overlay = renderOverlay();
    expect(overlay.style.opacity).toBe('1');
  });
});
