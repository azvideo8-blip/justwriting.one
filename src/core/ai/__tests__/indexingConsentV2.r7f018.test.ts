import { beforeEach, describe, expect, it } from 'vitest';
import { getIndexingConsent, setIndexingConsent, useIndexingConsentStore, INDEXING_CONSENT_VERSION } from '../indexingConsent';

// R7F-018 (0.10.0): текст согласия на индексацию обещал шифрование векторов на
// устройстве, а локальная база открытая. Текст исправлен — это новая версия
// согласия: данное по старому тексту не переносится, человек отвечает заново.
// Мутация: вернуть ключ 'ai_indexing_consent' → первый тест красный.
describe('R7F-018: согласие на индексацию версии 2', () => {
  beforeEach(() => {
    localStorage.clear();
    useIndexingConsentStore.setState({ consents: {} });
  });

  it('согласие по старому тексту (версия 1) не считается — вопрос задаётся заново', () => {
    localStorage.setItem('ai_indexing_consent_u1', 'granted');
    expect(getIndexingConsent('u1')).toBe('unanswered');
  });

  it('ответ по новому тексту хранится и читается', () => {
    setIndexingConsent('u1', 'granted');
    useIndexingConsentStore.setState({ consents: {} });
    expect(getIndexingConsent('u1')).toBe('granted');
    expect(INDEXING_CONSENT_VERSION).toBe(2);
  });
});
