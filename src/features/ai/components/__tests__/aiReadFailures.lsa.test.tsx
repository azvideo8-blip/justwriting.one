// 0.11.22: блоки ИИ в профиле и окно памяти — сбой чтения не выглядит как «пусто».
// Раньше: портрет «ещё не создан», темы «не собраны», история «пока пуста»,
// память «ничего не запомнил», двери «нажми Разобрать» (а в профиле нажать нечего).
// Мутации (прогнаны, каждая красит свой тест): в catch вернуть 'done' вместо 'error'
// (портрет, история, темы, память); у дверей — 'idle' вместо 'error'; начальное
// состояние дверей 'idle' — кадр «пусто» до разбора.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: async () => true }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const db = vi.hoisted(() => ({ getAll: vi.fn(), getAllFromIndex: vi.fn() }));
vi.mock('../../../../core/storage/localDb', async (orig) => ({ ...(await orig<object>()), getLocalDb: async () => db }));
const portrait = vi.hoisted(() => ({ getPortrait: vi.fn(), isPortraitStale: vi.fn(async () => false) }));
vi.mock('../../services/AIProfileService', () => ({ AIProfileService: portrait }));
const facets = vi.hoisted(() => ({ getAll: vi.fn() }));
vi.mock('../../services/AIProfileFacetService', () => ({ AIProfileFacetService: facets }));
vi.mock('../../services/AIFacetJudgeService', () => ({ AIFacetJudgeService: { getLog: () => null } }));
const story = vi.hoisted(() => ({ getAll: vi.fn(async () => []), getDefaultEventDate: (d: string) => d }));
vi.mock('../../services/LifeStoryService', () => ({ LifeStoryService: story }));
const memory = vi.hoisted(() => ({ getAll: vi.fn() }));
vi.mock('../../services/AIChatMemoryService', () => ({ AIChatMemoryService: memory, isUnreviewedLegacyMemory: () => false }));

import { AuthorPortrait } from '../AuthorPortrait';
import { LifeStoryTimeline } from '../LifeStoryTimeline';
import { ProfileFacets } from '../ProfileFacets';
import { MemoryManagerModal } from '../MemoryManagerModal';
import { ContactDoors } from '../ContactDoors';

const idbDown = () => Promise.reject(new Error('idb down'));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  db.getAll.mockResolvedValue([]);
  db.getAllFromIndex.mockResolvedValue([]);
});

describe('ИИ-блоки: не прочиталось ≠ пусто', () => {
  it('портрет: ошибка с «Повторить», не «ещё не создан»; повтор перечитывает', async () => {
    portrait.getPortrait.mockImplementationOnce(idbDown).mockResolvedValueOnce('Синтетический портрет');
    render(<AuthorPortrait readOnly />);
    await screen.findByRole('alert');
    expect(screen.queryByText('ai_portrait_not_created')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByText('Синтетический портрет')).toBeTruthy());
  });

  it('история жизни: ошибка с «Повторить», не «пока пуста»', async () => {
    db.getAll.mockImplementation(idbDown);
    render(<LifeStoryTimeline />);
    await screen.findByRole('alert');
    expect(screen.queryByText('ai_timeline_empty')).toBeNull();
    db.getAll.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByText('ai_timeline_empty')).toBeTruthy());
  });

  it('темы: ошибка с «Повторить», не «не собраны»', async () => {
    facets.getAll.mockImplementation(idbDown);
    render(<ProfileFacets readOnly />);
    await screen.findByRole('alert');
    expect(screen.queryByText('admin_facets_empty')).toBeNull();
    expect(screen.queryByText('admin_facets_warmup')).toBeNull();
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy();
  });

  it('память ИИ: ошибка с «Повторить», не «ничего не запомнил»', async () => {
    memory.getAll.mockImplementation(idbDown);
    render(<MemoryManagerModal onClose={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('ai_memory_empty')).toBeNull();
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy();
  });

  it('двери в профиле: первый кадр — не «пусто»; сбой — ошибка с «Повторить»', async () => {
    db.getAllFromIndex.mockImplementation(idbDown);
    // Первый кадр без эффектов (как до первого чтения в браузере).
    expect(renderToStaticMarkup(<ContactDoors readOnly />)).not.toContain('ai_doors_empty');
    render(<ContactDoors readOnly />);
    await screen.findByRole('alert');
    expect(screen.queryByText('ai_doors_empty')).toBeNull();
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy();
  });
});
