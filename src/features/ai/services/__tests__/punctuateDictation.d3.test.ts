// D-3: пунктуация одного куска диктовки.
//
// Главное свойство, которое здесь сторожится: диктовка не может провалиться из-за
// пунктуации. Любой отказ — исходный текст; на двух ветках (нет согласия, заметка
// скрыта) запрос к ИИ не отправляется вовсе; запрос к заметке, спрятанной от ИИ,
// не уносит её текст наружу.
//
// Мутации: убрать сверку sameWords → (b) красный; убрать ветку note-hidden →
// (e) красный; вернуть ветку vault → (f) красный.
import { sameWords } from '../../../../shared/ai/sameWords';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { processMock, useRequestMock, getEncryptionEnabledMock, dbGetMock, limitState, authState, consentState } = vi.hoisted(() => ({
  processMock: vi.fn(),
  useRequestMock: vi.fn(),
  getEncryptionEnabledMock: vi.fn(() => false),
  dbGetMock: vi.fn(),
  limitState: { remaining: 10 },
  authState: { user: { uid: 'u_d3' } as { uid: string } | null },
  consentState: { value: true },
}));

vi.mock('../../services/AIService', () => ({
  AIService: { process: processMock },
}));

vi.mock('../../store/useAiLimitStore', () => ({
  useAiLimitStore: {
    getState: () => ({ remaining: limitState.remaining, useRequest: useRequestMock }),
  },
}));

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => authState.user,
  getIdToken: vi.fn(),
}));

vi.mock('../../../../core/ai/aiConsent', () => ({
  getAiConsent: () => consentState.value,
}));

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: async () => ({ get: dbGetMock }),
}));

vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: { getState: () => ({ getEncryptionEnabled: getEncryptionEnabledMock }) },
}));

import { MAX_AI_CONTENT_LENGTH } from '../../../../shared/ai/buildChatPrompt';
import { punctuateDictation, willPunctuate } from '../punctuateDictation';

const RAW = 'сегодня бегал утром темп был тяжёлый';
const PUNCTUATED = 'Сегодня бегал утром, темп был тяжёлый.';

beforeEach(() => {
  vi.clearAllMocks();
  limitState.remaining = 10;
  authState.user = { uid: 'u_d3' };
  consentState.value = true;
  getEncryptionEnabledMock.mockReturnValue(false);
  dbGetMock.mockResolvedValue({ id: 'doc_1', title: 'Заметка' });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  processMock.mockResolvedValue({ ok: true, text: PUNCTUATED });
});

describe('D-3: punctuateDictation', () => {
  it('(a) успех: возвращает текст с знаками и списывает один запрос', async () => {
    const res = await punctuateDictation(RAW, { documentId: 'doc_1' });
    expect(res).toEqual({ text: PUNCTUATED, punctuated: true });
    expect(useRequestMock).toHaveBeenCalledTimes(1);
  });

  it('(b) модель тронула слова: отдаём исходник, запрос не списан', async () => {
    processMock.mockResolvedValue({ ok: true, text: 'Сегодня бегал вечером, темп был тяжёлый.' });
    const res = await punctuateDictation(RAW, { documentId: 'doc_1' });
    expect(res.text).toBe(RAW);
    expect(res.punctuated).toBe(false);
    expect(res.reason).toBe('words-changed');
    expect(useRequestMock).not.toHaveBeenCalled();
  });

  // Hotfix 0.9.34 (прод, двухминутная диктовка): модель «починила» одно слово
  // распознавания — и вся пунктуация выбрасывалась. Теперь знаки переносятся на
  // исходные слова. Мутация: снова «слова не совпали → исходник» → красный.
  it('(b2) модель исправила одно слово в длинном тексте: знаки есть, слова исходные', async () => {
    const raw = 'утром вышли на пробежку было холодно толли от ветра толли от недосыпа потом пили чай и долго говорили о планах на осень';
    processMock.mockResolvedValue({ ok: true, text: 'Утром вышли на пробежку. Было холодно: то ли от ветра, то ли от недосыпа. Потом пили чай и долго говорили о планах на осень.' });
    const res = await punctuateDictation(raw, { documentId: 'doc_1' });
    expect(res.punctuated).toBe(true);
    expect(sameWords(raw, res.text)).toBe(true);
    expect(res.text).toContain('Утром вышли на пробежку. Было холодно:');
    expect(res.text.endsWith('осень.')).toBe(true);
    expect(useRequestMock).toHaveBeenCalledTimes(1);
  });

  it('(c) каждая причина возвращает исходный текст и никогда не бросает', async () => {
    const cases: Array<{ name: string; setup: () => void; reason: string }> = [
      { name: 'empty', setup: () => undefined, reason: 'empty' },
      { name: 'offline', setup: () => { Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true }); }, reason: 'offline' },
      { name: 'not-signed-in', setup: () => { authState.user = null; }, reason: 'not-signed-in' },
      { name: 'no-consent', setup: () => { consentState.value = false; }, reason: 'no-consent' },
      { name: 'note-hidden', setup: () => { dbGetMock.mockResolvedValue({ id: 'doc_1', excludedFromAI: true }); }, reason: 'note-hidden' },
      { name: 'note-trashed', setup: () => { dbGetMock.mockResolvedValue({ id: 'doc_1', trashedAt: 1 }); }, reason: 'note-hidden' },
      { name: 'note-read-failed', setup: () => { dbGetMock.mockRejectedValue(new Error('db')); }, reason: 'note-hidden' },
      { name: 'note-missing', setup: () => { dbGetMock.mockResolvedValue(undefined); }, reason: 'note-hidden' },
      { name: 'limit', setup: () => { limitState.remaining = 0; }, reason: 'limit' },
      { name: 'too-long', setup: () => undefined, reason: 'too-long' },
      { name: 'error', setup: () => { processMock.mockResolvedValue({ ok: false, error: 'SERVER_ERROR' }); }, reason: 'error' },
    ];

    for (const c of cases) {
      vi.clearAllMocks();
      consentState.value = true;
      authState.user = { uid: 'u_d3' };
      limitState.remaining = 10;
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
      dbGetMock.mockResolvedValue({ id: 'doc_1' });
      processMock.mockResolvedValue({ ok: true, text: PUNCTUATED });
      c.setup();
      const input = c.name === 'empty' ? '   ' : c.name === 'too-long' ? 'а '.repeat(MAX_AI_CONTENT_LENGTH + 10) : RAW;
      const res = await punctuateDictation(input, { documentId: 'doc_1' });
      expect(res.reason, c.name).toBe(c.reason);
      expect(res.punctuated, c.name).toBe(false);
      // «empty» — единственный случай, где текста нет: там возвращается пустая
      // строка, а не исходный мусор из пробелов.
      expect(res.text, c.name).toBe(c.name === 'empty' ? '' : input);
      expect(useRequestMock, c.name).not.toHaveBeenCalled();
    }
  });

  it('(d) process бросает: исходник и причина error', async () => {
    processMock.mockRejectedValue(new Error('boom'));
    const res = await punctuateDictation(RAW, { documentId: 'doc_1' });
    expect(res).toEqual({ text: RAW, punctuated: false, reason: 'error' });
  });

  it('(e) без согласия и на скрытой заметке запрос к ИИ не отправляется', async () => {
    consentState.value = false;
    await punctuateDictation(RAW, { documentId: 'doc_1' });
    expect(processMock).not.toHaveBeenCalled();

    consentState.value = true;
    dbGetMock.mockResolvedValue({ id: 'doc_1', excludedFromAI: true });
    await punctuateDictation(RAW, { documentId: 'doc_1' });
    expect(processMock).not.toHaveBeenCalled();
  });

  it('(f) включённый сейф не блокирует пунктуацию (решение владельца 09.10.2026)', async () => {
    getEncryptionEnabledMock.mockReturnValue(true);
    const res = await punctuateDictation(RAW, { documentId: 'doc_1' });
    expect(res).toEqual({ text: PUNCTUATED, punctuated: true });
  });

  it('текст нового несохранённого документа (без documentId) пунктуется', async () => {
    const res = await punctuateDictation(RAW, {});
    expect(res.punctuated).toBe(true);
    expect(dbGetMock).not.toHaveBeenCalled();
  });
});

describe('D-3: willPunctuate — предсказание для ИИ-метки', () => {
  it('да — когда есть аккаунт, согласие, запросы и заметка не скрыта', () => {
    expect(willPunctuate()).toEqual({ yes: true, remaining: 10 });
    expect(willPunctuate({ noteHidden: true }).yes).toBe(false);
  });

  it('нет — без аккаунта, без согласия и без дневных запросов', () => {
    authState.user = null;
    expect(willPunctuate().yes).toBe(false);
    authState.user = { uid: 'u_d3' };
    consentState.value = false;
    expect(willPunctuate().yes).toBe(false);
    consentState.value = true;
    limitState.remaining = 0;
    expect(willPunctuate()).toEqual({ yes: false, remaining: 0 });
  });
});
