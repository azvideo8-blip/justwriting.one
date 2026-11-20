// d41d (Н-4): «Собрать темы» показывает зелёное «Темы профиля построены: N»,
// затем void summarizePending(...).then(load).catch(reportError): возврат
// {done, failed} (AIProfileFacetSummarizer:120-163) не читается. Отказ провайдера
// оставляет грани pendingSummary с текстом-выдержкой, а человек видит успех.
// Сосед AIProfileRefreshService:149-150 читает pending.failed — держит (0.11.22).
// Настоящие ProfileFacets + ToastProvider; моки только края (сервис граней, судья).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createElement as h } from 'react';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/shared/components/Toast';

const summarizePending = vi.hoisted(() => vi.fn());

vi.mock('@/features/ai/services/AIProfileFacetService', () => ({
  AIProfileFacetService: {
    build: vi.fn(async () => ({ ok: true, count: 2 })),
    getAll: vi.fn(async () => []),
    summarizePending,
  },
}));
vi.mock('@/features/ai/services/AIFacetJudgeService', () => ({
  AIFacetJudgeService: { getLog: () => null, review: vi.fn(async () => ({ judged: 0 })) },
}));
vi.mock('@/shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string, n: number) => `${k}:${n}`, language: 'ru' }),
}));
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { ProfileFacets } from '@/features/ai/components/ProfileFacets';

function renderFacets() {
  return render(
    h(MemoryRouter, null, h(ToastProvider, null, h(ProfileFacets, {}))),
  );
}

beforeEach(() => { cleanup(); vi.clearAllMocks(); });

describe('d41d: отказ суммаризации граней после построения тем назван', () => {
  it('summarizePending вернул failed=2 — предупреждение/ошибка, а не только зелёное «построены»', async () => {
    summarizePending.mockResolvedValue({ done: 0, failed: 2 });
    const { container } = renderFacets();
    const btn = await screen.findByRole('button', { name: 'admin_build_btn' });
    fireEvent.click(btn);
    await waitFor(() => { expect(summarizePending).toHaveBeenCalled(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(
      container.querySelector('.text-accent-danger, .text-accent-warning'),
      'две грани остались без сводок (failed=2), а итог — только зелёный тост построения',
    ).toBeTruthy();
    // FN-4: «построены» зелёным не показывается, пока часть граней без сводок.
    expect(screen.queryByText('Темы профиля построены: 2')).toBeNull();
    expect(screen.getByText('ai_facets_resummarize_partial')).toBeTruthy();
  });

  it('КОНТРОЛЬ: все грани суммаризированы — зелёное «построены», без предупреждений', async () => {
    summarizePending.mockResolvedValue({ done: 2, failed: 0 });
    const { container } = renderFacets();
    const btn = await screen.findByRole('button', { name: 'admin_build_btn' });
    fireEvent.click(btn);
    await waitFor(() => { expect(screen.getByText('Темы профиля построены: 2')).toBeTruthy(); });
    await waitFor(() => { expect(summarizePending).toHaveBeenCalled(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('.text-accent-danger, .text-accent-warning')).toBeNull();
  });

  // Ревью exec-2026-11-20: суммаризация бросила после удачного построения — не «Ошибка построения тем».
  it('summarizePending бросил — предупреждение «построены, сводки не составлены», не «Ошибка построения тем»', async () => {
    summarizePending.mockRejectedValue(new Error('MARKER_SUMMARIZER_DB'));
    renderFacets();
    fireEvent.click(await screen.findByRole('button', { name: 'admin_build_btn' }));
    await waitFor(() => { expect(screen.getByText('ai_facets_built_summary_failed')).toBeTruthy(); });
    expect(screen.queryByText('Ошибка построения тем')).toBeNull();
  });
});
