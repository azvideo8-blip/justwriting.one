// MF-23 (SA-16, решение владельца): приложение говорит с человеком на «ты». В
// русских строках интерфейса нет «вы / вас / ваш…». EN остаётся «you».
import { describe, it, expect } from 'vitest';
import { commonTranslations } from '../translations/common';
import { writingTranslations } from '../translations/writing';
import { archiveTranslations } from '../translations/archive';
import { profileTranslations } from '../translations/profile';
import { settingsTranslations } from '../translations/settings';
import { authTranslations } from '../translations/auth';
import { lifelogTranslations } from '../translations/lifelog';
import { aiTranslations } from '../translations/ai';
import { adminTranslations } from '../translations/admin';
import { activityTranslations } from '../translations/activity';
import { authScreensTranslations } from '../translations/authScreens';

// Тексты согласий: их формулировка записывается вместе с версией согласия
// (privacy / indexing), правка требует новой версии и повторного согласия —
// решение владельца, не этого пакета. Остальное — на «ты».
const LEGAL = new Set([
  'privacy_consent_intro',
  'privacy_consent_storage_p1_before',
  'privacy_consent_storage_p1_after',
  'privacy_consent_third_party_p1_strong',
  'privacy_consent_third_party_p1_after',
  'privacy_consent_third_party_p3',
  'indexing_consent_when_sent_desc',
]);

const ALL = {
  ...commonTranslations, ...writingTranslations, ...archiveTranslations, ...profileTranslations,
  ...settingsTranslations, ...authTranslations, ...lifelogTranslations, ...aiTranslations,
  ...adminTranslations, ...activityTranslations, ...authScreensTranslations,
} as Record<string, { ru?: unknown }>;

const VY = /(^|[^а-яё])(вы|вас|вам|вами|ваш[а-яё]*)(?=[^а-яё]|$)/iu;

describe('MF-23: «ты» everywhere in RU UI strings', () => {
  it('no «вы / вас / ваш…» outside the legal consent keys', () => {
    const hits = Object.entries(ALL)
      .filter(([k, v]) => !LEGAL.has(k) && VY.test(String(v.ru ?? '')))
      .map(([k, v]) => `${k}: ${String(v.ru).slice(0, 60)}`);
    expect(hits).toEqual([]);
  });

  it('the allow-list only names real keys', () => {
    for (const k of LEGAL) expect(ALL[k], k).toBeDefined();
  });
});
