import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { AIChatMessages } from '../../components/chat/AIChatMessages';
import * as transport from '../../utils/aiChatTransport';
import { getLocalDb } from '../../../../core/storage/localDb';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { setAiConsent, useAiConsentStore } from '../../../../core/ai/aiConsent';
import { setProfileLoaded } from '../../../../core/crypto/cryptoHelpers';
import * as auth from '../../../../core/auth';
import { LanguageProvider } from '../../../../shared/i18n';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { reportError } from '../../../../shared/errors/reportError';

// S-31: «нет согласия на ИИ» — состояние, а не техническая ошибка. До правки
// стрим падал на клиентском гейте, хук писал reportError и звал callable, тот
// падал так же — в журнале активности два «Техническая ошибка», а в чате красная
// плашка, по которой ничего не сделать.

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({
  getCurrentUser: vi.fn(),
  getIdToken: vi.fn(),
}));

const convVisual = { color: '#888', mono: 'E', role: { ru: 'Роль', en: 'Role' } };
const aiFetchCalls: string[] = [];

function Harness({ onOpenSettings }: { onOpenSettings: () => void }) {
  const chat = useAIChat(null, 'editor');
  const [returned, setReturned] = useState('none');
  return (
    <>
      <button type="button" onClick={() => { void chat.sendMessage('привет').then(id => setReturned(id === null ? 'null' : 'id')); }}>send</button>
      <span data-testid="returned">{returned}</span>
      <AIChatMessages
        displayMessages={[]}
        streamingMessage={chat.streamingMessage}
        streamingReasoning={chat.streamingReasoning}
        isLoading={chat.isLoading}
        error={chat.error}
        clearError={chat.clearError}
        consentRequired={chat.consentRequired}
        onOpenSettings={onOpenSettings}
        convPersonaName="Editor"
        convVisual={convVisual}
        onCopyMessage={() => {}}
        onDeleteMessage={() => {}}
        onFeedback={() => {}}
        onRegenerate={() => {}}
        onSwitchVariant={() => {}}
        onCreateNote={() => {}}
        onForcedSearch={() => {}}
        dailyLimitRemaining={10}
        followUps={[]}
        onSuggestion={() => {}}
        starters={[]}
        activeDialogueId={null}
        activePersonaName="Editor"
        headerVisual={convVisual}
        proactiveHint={null}
        setInputText={() => {}}
        isMobile={false}
        messagesEndRef={{ current: null }}
        previewSession={null}
        onClosePreview={() => {}}
        setCitationPreviewSession={() => {}}
      />
    </>
  );
}

function renderLang(lang: 'ru' | 'en', onOpenSettings: () => void) {
  localStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, lang);
  return render(
    <LanguageProvider>
      <Harness onOpenSettings={onOpenSettings} />
    </LanguageProvider>,
  );
}

const WAIT = { timeout: 15_000 };

describe('S-31: chat without AI consent', { timeout: 40_000 }, () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    localStorage.clear();
    transport._resetStreamUnavailable();
    useAiConsentStore.setState({ consents: {} });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
    useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false });
    vi.mocked(auth.getCurrentUser).mockReturnValue({ uid: 'user-123', email: 'someone@example.com' } as never);
    vi.mocked(auth.getIdToken).mockResolvedValue('valid-token');
    // Служебные чтения профиля отвечают пустым списком, любой вызов ИИ
    // записывается и падает — так видно, дошло ли дело до запроса.
    aiFetchCalls.length = 0;
    global.fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/')) { aiFetchCalls.push(url); return Promise.reject(new Error('AI_FETCH_RAN')); }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const db = await getLocalDb();
    for (const store of ['documents', 'versions', 'aiDialogues'] as const) {
      const all = await db.getAll(store);
      for (const rec of all) await db.delete(store, (rec as { id: string }).id);
    }
    setProfileLoaded('user-123', true);
  });

  it('no request, no callable fallback, no reportError — a hint with a route instead', async () => {
    setAiConsent('user-123', false);
    const callable = vi.spyOn(transport, 'callableChat').mockRejectedValue(new Error('CALLABLE_RAN'));
    const openSettings = vi.fn();
    renderLang('ru', openSettings);

    await act(async () => { screen.getByRole('button', { name: 'send' }).click(); });

    expect(callable).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    expect(aiFetchCalls).toEqual([]);

    await waitFor(() => {
      expect(screen.getByText(/разрешите его использование в настройках/)).toBeInTheDocument();
    }, WAIT);

    // Плашки «техническая ошибка» в DOM быть не должно.
    expect(screen.queryByText(/Произошла ошибка|Ошибка сервиса/)).not.toBeInTheDocument();
    // null — сигнал useAIPageData вернуть набранный текст в поле ввода.
    await waitFor(() => {
      expect(screen.getByTestId('returned').textContent).toBe('null');
    }, WAIT);

    screen.getByRole('button', { name: 'Открыть настройки' }).click();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('the hint comes from i18n in English too', async () => {
    setAiConsent('user-123', false);
    renderLang('en', () => {});

    await act(async () => { screen.getByRole('button', { name: 'send' }).click(); });

    await waitFor(() => {
      expect(screen.getByTestId('returned').textContent).toBe('null');
    }, WAIT);
    expect(screen.getByText(/allow it in Settings/)).toBeInTheDocument();
  });

  it('consent granted: the same send goes through', async () => {
    setAiConsent('user-123', true);
    vi.spyOn(transport, 'streamChat').mockResolvedValue('Привет. О чём поговорим?');
    vi.spyOn(transport, 'callableChat').mockResolvedValue('Привет. О чём поговорим?');
    renderLang('ru', () => {});

    await act(async () => { screen.getByRole('button', { name: 'send' }).click(); });

    await waitFor(() => {
      expect(screen.getByTestId('returned').textContent).toBe('id');
    }, WAIT);
    expect(screen.queryByText(/разрешите его использование в настройках/)).not.toBeInTheDocument();
  });

  it('AIPage wires the hint to the same settings section the archive uses', () => {
    const page = readFileSync(resolve(__dirname, '../../../../app/pages/AIPage.tsx'), 'utf8');
    expect(page).toContain('consentRequired={consentRequired}');
    expect(page).toContain("navigate('/settings#security')");
  });
});
