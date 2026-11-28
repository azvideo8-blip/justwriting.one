// Дейлик 28.11 (Н-4): запрет ИИ-панели для скрытой заметки держался на телефоне одной
// строкой (`documentId` в LiveAIPanel) без теста — снятие пропа оставляло CI зелёным.
// Оба входа — телефонный LiveAIPanel и десктопный LiveAIPanelContent — с настоящим
// AIPanel, AIService.process и IndexedDB; подменён только сетевой край (callAi).
// Мутация: снять `documentId` в LiveAIPanel или LiveAIPanelContent — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ReactElement } from 'react';

const callAi = vi.hoisted(() => vi.fn());
vi.mock('../../../core/ai/callAi', async importOriginal => ({ ...(await importOriginal<object>()), callAi }));
vi.mock('../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'ru' }) }));
vi.mock('../../../core/auth', async importOriginal => ({ ...(await importOriginal<object>()), getCurrentUser: () => ({ uid: 'u-n4' }) }));

import { LiveAIPanel } from '../LiveAIPanel';
import { LiveAIPanelContent } from '../DesktopWritingLayout';
import { useContentStore } from '../../../features/writing/store/useContentStore';
import { useSessionMetaStore } from '../../../features/writing/store/useSessionMetaStore';
import { useAiLimitStore } from '../../../features/ai/store/useAiLimitStore';
import { getLocalDb } from '../../../core/storage/localDb';

const doc = (id: string, over: object = {}) => ({
  id, guestId: 'u-n4', title: id, currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1,
  firstSessionAt: 1, lastSessionAt: 1, tags: [], ...over,
});

beforeEach(async () => {
  vi.clearAllMocks();
  callAi.mockResolvedValue({ text: 'ответ модели' });
  useAiLimitStore.setState({ remaining: 5 });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  useContentStore.getState().setContent('MARKER_N4_PANEL синтетический текст для проверки панели');
  const db = await getLocalDb();
  await db.clear('documents');
  await db.put('documents', doc('visible') as never);
  await db.put('documents', doc('hidden', { excludedFromAI: true }) as never);
});

const press = () => act(async () => { fireEvent.click(screen.getByText('ai_action_ideas')); await new Promise(r => setTimeout(r, 50)); });

describe.each([
  ['телефон: LiveAIPanel', () => <LiveAIPanel open onClose={() => {}} />],
  ['десктоп: LiveAIPanelContent', () => <LiveAIPanelContent />],
] as [string, () => ReactElement][])('Н-4: %s', (_n, panel) => {
  it('открыта скрытая заметка — подпись видна, модели ничего не ушло', async () => {
    useSessionMetaStore.getState().setSavedDocumentId('hidden');
    render(panel());
    expect(await screen.findByTestId('ai-panel-note-hidden')).toBeInTheDocument();
    await press();
    expect(callAi).not.toHaveBeenCalled();
  });

  it('контроль: видимая заметка — текст уходит', async () => {
    useSessionMetaStore.getState().setSavedDocumentId('visible');
    render(panel());
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    await press();
    expect(callAi).toHaveBeenCalled();
  });
});
