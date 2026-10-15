// SA-24: подсказки тегов на телефоне — только существующие теги человека, совпавшие с
// текстом (не больше двух); подписи настроения — 12 px `--text-muted` без opacity-обёрток.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WritingFinishModal } from '../WritingFinishModal';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

const mockShowToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    quietStats: false,
    setQuietStats: vi.fn(),
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    motion: {
      div: ({ children, className, onClick, ...props }: any) => (
        <div className={className} onClick={onClick} {...props}>{children}</div>
      ),
      button: ({ children, className, onClick, ...props }: any) => (
        <button className={className} onClick={onClick} {...props}>{children}</button>
      ),
    },
    useReducedMotion: () => true,
  };
});
vi.mock('../WpmChart', () => ({ WpmChart: () => <div data-testid="wpm-chart" /> }));
vi.mock('../../../lifeLog/hooks/useCorpusDf', () => ({
  buildCorpusDf: vi.fn().mockResolvedValue({ df: new Map(), N: 0 }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const userDocs = vi.hoisted(() => ({ tags: [] as string[][] }));
vi.mock('../../../../core/services/LocalDocumentService', async (orig) => {
  const actual = await orig<typeof import('../../../../core/services/LocalDocumentService')>();
  return {
    ...actual,
    LocalDocumentService: {
      ...actual.LocalDocumentService,
      getDocumentsByOwner: vi.fn(async () => userDocs.tags.map((tags, i) => ({ id: `d${i}`, tags }))),
    },
  };
});

const TEXT = 'Сегодня глина была послушной. Впервые за неделю руки сами знали, что делать. Вечером была работа в мастерской.';

function renderModal() {
  return render(<WritingFinishModal isOpen onCancel={vi.fn()} onSave={vi.fn().mockResolvedValue({ docId: 'doc_1', cloudSynced: true, isTooLarge: false })} />);
}

const chips = (container: HTMLElement) =>
  Array.from(container.ownerDocument.querySelectorAll('[aria-labelledby="finish-modal-title"] button[aria-pressed]'))
    .map(b => b.textContent ?? '').filter(t => t.startsWith('#'));

describe('SA-24: phone tag suggestions', () => {
  beforeEach(() => {
    cleanup();
    layoutMode = 'mobile';
    userDocs.tags = [];
    useContentStore.setState({ content: TEXT, wordCount: 17, initialWordCount: 0, wpm: 40 });
    useTimerStore.setState({ seconds: 40, sessionStartSeconds: 0, accumulatedDuration: 40, totalPauseSeconds: 0, status: 'idle' } as Partial<ReturnType<typeof useTimerStore.getState>>);
    useSessionMetaStore.setState({ savedDocumentId: 'doc_1', sessionStartTime: Date.now() });
  });

  it('no existing tags: no suggestions at all (the words of the text are not offered)', async () => {
    const { container } = renderModal();
    await new Promise(r => setTimeout(r, 30));
    expect(chips(container)).toEqual([]);
  });

  it('existing tags that match the text (by stem) are offered, at most two', async () => {
    userDocs.tags = [['глина', 'мама'], ['работа', 'море'], ['мастерская', 'глина'], ['неделя']];
    const { container } = renderModal();
    await waitFor(() => expect(chips(container).length).toBeGreaterThan(0));
    const got = chips(container);
    expect(got.length).toBeLessThanOrEqual(2);
    for (const c of got) expect(['#глина', '#работа', '#мастерская', '#неделя']).toContain(c);
    expect(got).not.toContain('#мама');
    expect(got).not.toContain('#море');
  });

  it('the six moods sit in a 3-column grid on the phone — one row of 12 px captions overflowed 360 px', async () => {
    renderModal();
    const label = await screen.findByText('mood_happy');
    const row = label.closest('button')!.parentElement!;
    expect(row.className).toContain('grid-cols-3');
    expect(row.children).toHaveLength(6);
  });

  it('mood captions are 12 px --text-muted with no opacity ancestor', async () => {
    const { container } = renderModal();
    const label = await screen.findByText('mood_happy');
    expect(label.className).toContain('text-[12px]');
    expect(label.className).toContain('text-text-muted');
    for (let el: HTMLElement | null = label; el && el !== container.ownerDocument.body; el = el.parentElement) {
      expect(/(^|\s)opacity-\d+/.test(el.className), `opacity-обёртка: ${el.className}`).toBe(false);
    }
  });
});

// Подпись без opacity-обёрток красится самим токеном: он обязан держать AA в каждой теме
// и на фоне страницы, и на фоне листа (`--surface-popup`).
describe('SA-24: --text-muted holds 4.5:1 in every theme', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
  const lum = (hex: string) => {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };
  const hexIn = (block: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(block)?.[1];
  const blocks = [...css.matchAll(/(?:\.theme-([a-z]+)|:root)\s*\{([^}]*)\}/g)].filter(m => hexIn(m[2]!, 'text-muted') && hexIn(m[2]!, 'bg-base'));

  it('finds all four themes', () => { expect(blocks.length).toBeGreaterThanOrEqual(4); });
  for (const [, name, block] of blocks) {
    it(`${name ?? 'root'}: on the page and on the sheet`, () => {
      const muted = hexIn(block!, 'text-muted')!;
      expect(ratio(muted, hexIn(block!, 'bg-base')!)).toBeGreaterThanOrEqual(4.5);
      const popup = hexIn(block!, 'surface-popup');
      if (popup) expect(ratio(muted, popup)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
