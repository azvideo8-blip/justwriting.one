import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, waitFor, screen } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { AIChatComposer } from '../../components/chat/AIChatComposer';
import { getLocalDb } from '../../../../core/storage/localDb';
import * as transport from '../../utils/aiChatTransport';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { renderWithProviders } from '../../../../test/utils/render';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

// R4-010: единственный тест, который идёт от реального текста через detectRisk
// внутри useAIChatContext к панели помощи в DOM: хук-тесты мокают buildContext,
// а тест композера подаёт crisisActive как prop — разрыв setCrisisActive ни
// один из них не ловит.
function ChatHarness({ text }: { text: string }) {
  const chat = useAIChat(null, 'editor');
  return (
    <>
      <AIChatComposer
        isMobile={false}
        inputText=""
        setInputText={() => {}}
        inputRef={{ current: null }}
        isLoading={chat.isLoading}
        onStop={() => {}}
        onSend={() => {}}
        pendingAttachments={[]}
        removePendingAttachment={() => {}}
        onPasteAsNote={() => {}}
        attachMenuOpen={false}
        setAttachMenuOpen={() => {}}
        attachMenuRef={{ current: null }}
        fileInputRef={{ current: null }}
        onFileUpload={() => {}}
        onOpenDocPicker={() => {}}
        dailyLimitRemaining={10}
        dailyLimitTotal={30}
        maxInputChars={1000}
        crisisActive={chat.crisisActive}
        dismissCrisis={chat.dismissCrisis}
      />
      <button type="button" onClick={() => void chat.sendMessage(text)}>send-risk</button>
    </>
  );
}

// R5-005: ждать здесь нечего, кроме настоящей цепочки (IndexedDB, сборка
// контекста, холодный импорт модулей) — таймеров-засыпаний нет, поддельные
// часы ничего не ускорят. Под нагрузкой (test:ci с покрытием) она шла 2.7–3.8 с
// при дефолтных 1 с у waitFor и 5 с у теста: красное без assertion'а. Бюджет
// waitFor меньше таймаута теста — поломка краснеет assertion'ом, а не таймаутом.
const WAIT = { timeout: 10_000 };

describe('useAIChat → crisis panel', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    transport._resetStreamUnavailable();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
    useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100000), loaded: true, isAdmin: false });
    const db = await getLocalDb();
    for (const store of ['documents', 'versions', 'aiDialogues', 'aiSummaries', 'aiEmbeddings'] as const) {
      const all = await db.getAll(store);
      for (const rec of all) await db.delete(store, (rec as { id: string }).id || (rec as { documentId: string }).documentId);
    }
    vi.spyOn(transport, 'streamChat').mockResolvedValue('Я рядом. Давай поговорим.');
  });

  it('риск-фраза с zero-width разделителем открывает панель помощи', async () => {
    renderWithProviders(<ChatHarness text={'не\u200Cхочу\u200Cжить'} />);
    await act(async () => {
      screen.getByRole('button', { name: 'send-risk' }).click();
    });
    await waitFor(() => {
      expect(screen.getByText(/ты не один/)).toBeInTheDocument();
    }, WAIT);
  });

  it('обычная фраза панель не открывает', async () => {
    renderWithProviders(<ChatHarness text="как дела на работе" />);
    await act(async () => {
      screen.getByRole('button', { name: 'send-risk' }).click();
    });
    await waitFor(() => {
      expect(transport.streamChat).toHaveBeenCalled();
    }, WAIT);
    expect(screen.queryByText(/ты не один/)).toBeNull();
  });
});
