import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChat } from '../useAIChat';
import { AIChatMessages } from '../../components/chat/AIChatMessages';
import * as transport from '../../utils/aiChatTransport';
import { getLocalDb } from '../../../../core/storage/localDb';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { setAiConsent, useAiConsentStore } from '../../../../core/ai/aiConsent';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { setProfileLoaded } from '../../../../core/crypto/cryptoHelpers';
import * as auth from '../../../../core/auth';
import { LanguageProvider } from '../../../../shared/i18n';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { reportError } from '../../../../shared/errors/reportError';
import { useActivityLogStore } from '../../../../shared/activity/useActivityLogStore';
import { resetAIDegradationSession } from '../../utils/aiDegradationReporter';

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

function Harness({ onOpenSettings, text = 'привет' }: { onOpenSettings: () => void; text?: string | undefined }) {
  const chat = useAIChat(null, 'editor');
  const [returned, setReturned] = useState('none');
  return (
    <>
      <button type="button" onClick={() => { void chat.sendMessage(text).then(id => setReturned(id === null ? 'null' : 'id')); }}>send</button>
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
                  convPersonaId="editor"
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

function renderLang(lang: 'ru' | 'en', onOpenSettings: () => void, text?: string) {
  localStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, lang);
  return render(
    <LanguageProvider>
      <Harness onOpenSettings={onOpenSettings} text={text} />
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
    setIndexingConsent('user-123', 'unanswered');
    useActivityLogStore.setState({ entries: [] });
    resetAIDegradationSession();
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

    await waitFor(() => {
      expect(screen.getByText(/разреши его использование в настройках/)).toBeInTheDocument();
    }, WAIT);
    // null — сигнал useAIPageData вернуть набранный текст в поле ввода.
    await waitFor(() => {
      expect(screen.getByTestId('returned').textContent).toBe('null');
    }, WAIT);

    // S-40.3: проверяем после завершения отправки, а не сразу после клика —
    // иначе reportError из catch стрима просто не успевал сработать.
    expect(callable).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    expect(aiFetchCalls).toEqual([]);
    // Плашки «техническая ошибка» в DOM быть не должно.
    expect(screen.queryByText(/Произошла ошибка|Ошибка сервиса/)).not.toBeInTheDocument();

    screen.getByRole('button', { name: 'Открыть настройки' }).click();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('S-40.4: a blocked send into a new dialogue leaves no empty dialogue record', async () => {
    setAiConsent('user-123', false);
    renderLang('ru', () => {});

    await act(async () => { screen.getByRole('button', { name: 'send' }).click(); });
    await waitFor(() => {
      expect(screen.getByTestId('returned').textContent).toBe('null');
    }, WAIT);
    expect(screen.getByText(/разреши его использование в настройках/)).toBeInTheDocument();

    const db = await getLocalDb();
    expect(await db.getAll('aiDialogues')).toEqual([]);
  });

  it('S-40.1/S-56: AI consent refused by the server (revoked on another device) — the hint, no reportError, no technical error, no empty dialogue', async () => {
    // Профиль не загружен — клиентский гейт молчит; индексация разрешена, так что
    // векторизация проходит, а отказ приходит с /api/chat — единственное место,
    // откуда сервер действительно отвечает AI_CONSENT_REQUIRED (api/handlers.ts).
    setProfileLoaded('user-123', false);
    setIndexingConsent('user-123', 'granted');
    const callable = vi.spyOn(transport, 'callableChat').mockRejectedValue(new Error('CALLABLE_RAN'));
    global.fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === '/api/embedDocument') {
        aiFetchCalls.push(url);
        return new Response(JSON.stringify({ result: { vectors: [[0.1, 0.2]], chunks: [], model: 'm', dim: 2 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === '/api/chat') {
        aiFetchCalls.push(url);
        return new Response(JSON.stringify({ error: { code: 'AI_CONSENT_REQUIRED', message: 'AI_CONSENT_REQUIRED' } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/api/')) { aiFetchCalls.push(url); return Promise.reject(new Error('AI_FETCH_RAN')); }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    renderLang('ru', () => {});

    await act(async () => { screen.getByRole('button', { name: 'send' }).click(); });
    await waitFor(() => {
      expect(screen.getByTestId('returned').textContent).toBe('null');
    }, WAIT);

    expect(screen.getByText(/разреши его использование в настройках/)).toBeInTheDocument();
    expect(screen.queryByText(/Произошла ошибка|Ошибка сервиса/)).not.toBeInTheDocument();
    expect(aiFetchCalls).toContain('/api/chat');
    // S-56.5: отказ стрима по согласию — не «Streaming chat failed», и без callable-повтора.
    expect(reportError).not.toHaveBeenCalled();
    expect(callable).not.toHaveBeenCalled();
    expect(useActivityLogStore.getState().entries.filter(e => e.level === 'error')).toEqual([]);
    // S-56.1: диалог, созданный под этот ход, не остаётся пустой записью.
    const db = await getLocalDb();
    expect(await db.getAll('aiDialogues')).toEqual([]);
  });

  it('S-56.3: indexing consent refused by the server — the turn answers in basic mode, no degradation record', async () => {
    setProfileLoaded('user-123', false);
    setIndexingConsent('user-123', 'granted');
    vi.spyOn(transport, 'streamChat').mockResolvedValue('Ответ в базовом режиме');
    global.fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === '/api/embedDocument') {
        aiFetchCalls.push(url);
        return new Response(JSON.stringify({ error: { code: 'INDEXING_CONSENT_REQUIRED', message: 'INDEXING_CONSENT_REQUIRED' } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      // Автоназвание нового диалога — отдельный служебный вызов, не часть хода.
      if (url === '/api/chatWithAI') return new Response(JSON.stringify({ result: { result: 'Название' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/api/')) { aiFetchCalls.push(url); return Promise.reject(new Error('AI_FETCH_RAN')); }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    // X-1: «привет» больше не векторизуется, поэтому ход здесь — реплика
    // достаточной длины: проверяется реакция на 403 от /api/embedDocument.
    renderLang('ru', () => {}, 'что делать с прокрастинацией вечером');

    await act(async () => { screen.getByRole('button', { name: 'send' }).click(); });
    await waitFor(() => {
      expect(screen.getByTestId('returned').textContent).toBe('id');
    }, WAIT);

    expect(aiFetchCalls, `лишние запросы: ${aiFetchCalls.join(', ')}`).toEqual(['/api/embedDocument']);
    expect(screen.queryByText(/разреши его использование в настройках/)).not.toBeInTheDocument();
    expect(reportError).not.toHaveBeenCalled();
    expect(useActivityLogStore.getState().entries.filter(e => e.level === 'error' || e.level === 'warning')).toEqual([]);
  });

  it('S-40.2: the direct callable path (streaming marked unavailable) shows the hint, not a technical error', async () => {
    // Клиентский гейт молчит (профиль не загружен); первый /api/chat отвечает
    // 404 — стрим помечается недоступным, дальше хук зовёт callable напрямую.
    setProfileLoaded('user-123', false);
    global.fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === '/api/chat') { aiFetchCalls.push(url); return new Response('', { status: 404 }); }
      if (url === '/api/chatWithAI') {
        aiFetchCalls.push(url);
        return new Response(JSON.stringify({ error: { code: 'AI_CONSENT_REQUIRED', message: 'AI_CONSENT_REQUIRED' } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/api/')) { aiFetchCalls.push(url); return Promise.reject(new Error('AI_FETCH_RAN')); }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    renderLang('ru', () => {});

    for (const attempt of [1, 2]) {
      await act(async () => { screen.getByRole('button', { name: 'send' }).click(); });
      await waitFor(() => {
        expect(screen.getByText(/разреши его использование в настройках/)).toBeInTheDocument();
      }, WAIT);
      expect(screen.queryByText(/Произошла ошибка|Ошибка сервиса/)).not.toBeInTheDocument();
      // Второй ход идёт в callable напрямую: /api/chat больше не трогается.
      expect(aiFetchCalls.filter(u => u === '/api/chat')).toHaveLength(1);
      expect(aiFetchCalls.filter(u => u === '/api/chatWithAI')).toHaveLength(attempt);
      await act(async () => { screen.getByRole('button', { name: 'Закрыть' }).click(); });
    }
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
    expect(screen.queryByText(/разреши его использование в настройках/)).not.toBeInTheDocument();
  });

  // Проводка подсказки в AIPage (consentRequired → AIChatMessages, «Открыть
  // настройки» → /settings#security) проверяется рендером страницы:
  // src/app/pages/__tests__/AIPageConsentHint.test.tsx (S-40.3).
});
