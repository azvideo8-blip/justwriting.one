// HA-1 (дейлик 26.11, Н-1): ИИ-панель экрана письма отдавала модели текст заметки,
// скрытой от ИИ или выброшенной в корзину. Настоящие AIPanel, AIService.process и
// IndexedDB; подменён только сетевой край (callAi).
// Мутации: снять проверку перед отправкой; снять проверку при открытии; сбой чтения
// строки = «видима» — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const callAi = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/ai/callAi', async importOriginal => ({ ...(await importOriginal<object>()), callAi }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'ru' }) }));
vi.mock('../../../../core/auth', async importOriginal => ({ ...(await importOriginal<object>()), getCurrentUser: () => ({ uid: 'u-ha1' }) }));

import { AIPanelContent } from '../AIPanel';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { getLocalDb } from '../../../../core/storage/localDb';

const TEXT = 'MARKER_HA1_PANEL_TEXT синтетическая запись для проверки панели';
const doc = (id: string, over: object = {}) => ({
  id, guestId: 'u-ha1', title: id, currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1,
  firstSessionAt: 1, lastSessionAt: 1, tags: [], ...over,
});

beforeEach(async () => {
  vi.clearAllMocks();
  callAi.mockResolvedValue({ text: 'ответ модели' });
  useAiLimitStore.setState({ remaining: 5 });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  const db = await getLocalDb();
  await db.clear('documents');
  await db.put('documents', doc('visible') as never);
  await db.put('documents', doc('hidden', { excludedFromAI: true }) as never);
  await db.put('documents', doc('trashed', { trashedAt: 1 }) as never);
});

const press = () => act(async () => { fireEvent.click(screen.getByText('ai_action_ideas')); await new Promise(r => setTimeout(r, 50)); });

describe('HA-1: ИИ-панель и заметка, скрытая от ИИ', () => {
  it.each(['hidden', 'trashed'])('%s: кнопки выключены, подпись видна, модели ничего не ушло', async id => {
    render(<AIPanelContent content={TEXT} documentId={id} />);
    expect(await screen.findByTestId('ai-panel-note-hidden')).toHaveTextContent('ai_panel_note_hidden');
    expect(screen.getByText('ai_action_ideas').closest('button')).toBeDisabled();
    await press();
    expect(callAi).not.toHaveBeenCalled();
  });

  it('строки нет или она не прочиталась — как скрытая', async () => {
    render(<AIPanelContent content={TEXT} documentId="missing" />);
    expect(await screen.findByTestId('ai-panel-note-hidden')).toBeInTheDocument();
    await press();
    expect(callAi).not.toHaveBeenCalled();
  });

  it('скрыли, пока панель открыта, — проверка перед отправкой', async () => {
    render(<AIPanelContent content={TEXT} documentId="visible" />);
    await waitFor(() => expect(screen.getByText('ai_action_ideas').closest('button')).not.toBeDisabled());
    await (await getLocalDb()).put('documents', doc('visible', { excludedFromAI: true }) as never);
    await press();
    expect(callAi).not.toHaveBeenCalled();
    expect(await screen.findByTestId('ai-panel-note-hidden')).toBeInTheDocument();
  });

  it.each([['видимая заметка', 'visible'], ['новый несохранённый текст', undefined]])('%s — текст уходит (контроль)', async (_n, id) => {
    render(<AIPanelContent content={TEXT} documentId={id} />);
    await waitFor(() => expect(screen.getByText('ai_action_ideas').closest('button')).not.toBeDisabled());
    await press();
    await waitFor(() => expect(callAi).toHaveBeenCalledWith('editWithAI', expect.objectContaining({ content: TEXT })));
    expect(screen.queryByTestId('ai-panel-note-hidden')).toBeNull();
  });
});
