import React, { createContext, useContext, useState, useCallback } from 'react';
import { commonTranslations } from './translations/common';
import { writingTranslations } from './translations/writing';
import { archiveTranslations } from './translations/archive';
import { profileTranslations } from './translations/profile';
import { settingsTranslations } from './translations/settings';
import { authTranslations } from './translations/auth';
import { lifelogTranslations } from './translations/lifelog';
import { aiTranslations } from './translations/ai';
import { adminTranslations } from './translations/admin';
import { activityTranslations } from './translations/activity';
import { Language, Translations } from './types';
import { STORAGE_KEYS } from '../constants/storageKeys';

export type { Language, Translations };

// DEBT-1 (#55): index-чанк не влезал в бюджет (806 933 при пороге 810 000).
// Переводы второстепенных пространств имён (~35 КБ минифицированного кода)
// вынесены в отдельные чанки: они догружаются параллельно при старте и
// доливаются в тот же объект до первого рендера детей провайдера. Ядро
// (common/writing/auth) остаётся eager — оно нужно первому экрану.
export const translations: Translations = {
  ...commonTranslations,
  ...writingTranslations,
  ...authTranslations,
  ...aiTranslations,
};

const lazyNamespaces: Promise<void> = Promise.all([
  import('./translations/settings').then(m => { Object.assign(translations, m.settingsTranslations); }),
  import('./translations/archive').then(m => { Object.assign(translations, m.archiveTranslations); }),
  import('./translations/profile').then(m => { Object.assign(translations, m.profileTranslations); }),
  import('./translations/lifelog').then(m => { Object.assign(translations, m.lifelogTranslations); }),
  import('./translations/admin').then(m => { Object.assign(translations, m.adminTranslations); }),
  import('./translations/activity').then(m => { Object.assign(translations, m.activityTranslations); }),
]).then(() => undefined);

/** Резолвится, когда все переводы на месте. Провайдер ждёт его до рендера,
 * чтобы t() никогда не вернул ключ вместо строки из-за гонки с чанками. */
export function whenTranslationsReady(): Promise<void> {
  return lazyNamespaces;
}

// В тестах переводы нужны синхронно: компонентные тесты рендерят провайдер
// без ожидания чанков. Ветка мертва в прод-сборке (VITEST не определён,
// импорты выпадают вместе с блоком при tree-shake).
if (import.meta.env.VITEST) {
  Object.assign(
    translations,
    settingsTranslations,
    archiveTranslations,
    profileTranslations,
    lifelogTranslations,
    adminTranslations,
    activityTranslations,
  );
}

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  tp: (key: string, count: number) => string;
}

const _missingKeyWarned = new Set<string>();
const MAX_MISSING_KEYS = 200;

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.APP_LANGUAGE);
    if (saved === 'ru' || saved === 'en') return saved as Language;
    return 'ru';
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, lang);
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    if (import.meta.env.DEV && !(key in translations) && !_missingKeyWarned.has(key)) {
      if (_missingKeyWarned.size < MAX_MISSING_KEYS) _missingKeyWarned.add(key);
      console.warn(`[i18n] Missing translation key: "${key}"`);
    }
    let str = translations[key]?.[language] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), () => String(v));
      });
    }
    return str;
  }, [language]);

  const tp = useCallback((key: string, count: number): string => {
    const getPluralSuffix = (n: number, lang: Language): string => {
      if (lang === 'ru') {
        const mod10 = n % 10;
        const mod100 = n % 100;
        if (mod100 >= 11 && mod100 <= 14) return '_many';
        if (mod10 === 1) return '_one';
        if (mod10 >= 2 && mod10 <= 4) return '_few';
        return '_many';
      }
      return n === 1 ? '_one' : '_other';
    };

    const suffix = getPluralSuffix(count, language);
    const fullKey = `${key}${suffix}`;
    const fallbackKey = language === 'en' && suffix === '_other' ? `${key}_many` : null;
    let str = translations[fullKey]?.[language] 
      ?? (fallbackKey ? translations[fallbackKey]?.[language] : undefined)
      ?? translations[key]?.[language] 
      ?? key;
    return str.replace('{count}', () => String(count));
  }, [language]);


  const tpFn = useCallback((key: string, count: number) => tp(key, count), [tp]);

  const [ready, setReady] = useState(import.meta.env.VITEST);

  React.useEffect(() => {
    let cancelled = false;
    whenTranslationsReady().then(() => { if (!cancelled) setReady(true); }).catch(() => { /* чанк не догрузился — останемся на ядре переводов */ });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const contextValue = React.useMemo(() => ({
    language,
    setLanguage,
    t,
    tp: tpFn
  }), [language, setLanguage, t, tpFn]);

  if (!ready) return null;

  return (
    <LanguageContext.Provider value={contextValue}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
