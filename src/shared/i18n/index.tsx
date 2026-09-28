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
import { authScreensTranslations } from './translations/authScreens';
import { Language, Translations } from './types';
import { STORAGE_KEYS } from '../constants/storageKeys';

import { reportError } from '../errors/reportError';

export type { Language, Translations };

// DEBT-1 (#55): index-чанк не влезал в бюджет (806 933 при пороге 810 000).
// Переводы второстепенных пространств имён (~35 КБ минифицированного кода)
// вынесены в отдельные чанки: они догружаются параллельно при старте и
// доливаются в тот же объект до первого рендера детей провайдера. Ядро
// (common/writing/auth/ai) остаётся eager — оно нужно первому экрану.
export const translations: Translations = {
  ...commonTranslations,
  ...writingTranslations,
  ...authTranslations,
  ...aiTranslations,
};

export type NamespaceLoader = () => Promise<Translations>;

export interface LazyNamespaceDef {
  name: string;
  load: NamespaceLoader;
}

export const LAZY_NAMESPACES: LazyNamespaceDef[] = [
  { name: 'settings', load: () => import('./translations/settings').then(m => m.settingsTranslations) },
  { name: 'archive', load: () => import('./translations/archive').then(m => m.archiveTranslations) },
  { name: 'profile', load: () => import('./translations/profile').then(m => m.profileTranslations) },
  { name: 'lifelog', load: () => import('./translations/lifelog').then(m => m.lifelogTranslations) },
  { name: 'admin', load: () => import('./translations/admin').then(m => m.adminTranslations) },
  { name: 'activity', load: () => import('./translations/activity').then(m => m.activityTranslations) },
  { name: 'authScreens', load: () => import('./translations/authScreens').then(m => m.authScreensTranslations) },
];

const loadedNamespaces = new Set<string>();
const failedNamespaces = new Map<string, { def: LazyNamespaceDef; attempts: number }>();
const reportedNamespaces = new Set<string>();
const updateListeners = new Set<() => void>();

export function subscribeToTranslationUpdates(listener: () => void): () => void {
  updateListeners.add(listener);
  return () => { updateListeners.delete(listener); };
}

function notifyTranslationUpdates() {
  updateListeners.forEach(l => l());
}

async function loadSingleNamespace(def: LazyNamespaceDef): Promise<boolean> {
  try {
    const data = await def.load();
    Object.assign(translations, data);
    loadedNamespaces.add(def.name);
    failedNamespaces.delete(def.name);
    notifyTranslationUpdates();
    return true;
  } catch (err) {
    if (!reportedNamespaces.has(def.name)) {
      reportedNamespaces.add(def.name);
      reportError(err, { action: `[i18n] Failed to load namespace chunk "${def.name}"` });
    }
    const current = failedNamespaces.get(def.name);
    failedNamespaces.set(def.name, {
      def,
      attempts: (current?.attempts ?? 0) + 1,
    });
    return false;
  }
}

async function retryFailedNamespace(name: string) {
  const maxAttempts = 3;
  for (;;) {
    // Счётчик читается из карты на каждом шаге: loadSingleNamespace при провале
    // кладёт в карту новый объект, и прежняя ссылка навсегда осталась бы с
    // attempts = 1 — то есть бесконечный опрос сети вместо трёх попыток.
    const item = failedNamespaces.get(name);
    if (!item || loadedNamespaces.has(name) || item.attempts >= maxAttempts) return;

    const backoffMs = Math.min(1000 * Math.pow(2, item.attempts - 1), 5000);
    await new Promise(resolve => setTimeout(resolve, backoffMs));
    if (loadedNamespaces.has(name)) return;
    const ok = await loadSingleNamespace(item.def);
    if (ok) return;
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', () => {
    for (const [name, item] of failedNamespaces.entries()) {
      if (!loadedNamespaces.has(name)) {
        item.attempts = 0;
        void loadSingleNamespace(item.def).then(ok => {
          if (!ok) void retryFailedNamespace(name);
        });
      }
    }
  });
}

let _readyPromise: Promise<void> | null = null;

export function initLazyNamespaces(namespaces: LazyNamespaceDef[] = LAZY_NAMESPACES): Promise<void> {
  const promises = namespaces.map(async def => {
    const ok = await loadSingleNamespace(def);
    if (!ok) {
      void retryFailedNamespace(def.name);
    }
  });
  _readyPromise = Promise.allSettled(promises).then(() => undefined);
  return _readyPromise;
}

if (!import.meta.env.VITEST) {
  _readyPromise = initLazyNamespaces();
}

/** Резолвится, когда все переводы на месте либо завершились ошибкой.
 * Провайдер ждёт его до рендера, но при ошибке чанка рендерит ядро переводов. */
export function whenTranslationsReady(): Promise<void> {
  if (!_readyPromise) {
    _readyPromise = initLazyNamespaces();
  }
  return _readyPromise;
}

let _forceAsyncReadyForTesting = false;
export function _setForceAsyncReadyForTesting(val: boolean) {
  _forceAsyncReadyForTesting = val;
}

export function _resetTranslationsForTesting(customNamespaces?: LazyNamespaceDef[]): Promise<void> | undefined {
  for (const k of Object.keys(translations)) {
    if (!(k in commonTranslations) && !(k in writingTranslations) && !(k in authTranslations) && !(k in aiTranslations)) {
      delete translations[k];
    }
  }
  loadedNamespaces.clear();
  failedNamespaces.clear();
  reportedNamespaces.clear();
  _readyPromise = null;
  if (customNamespaces) {
    return initLazyNamespaces(customNamespaces);
  }
}

export function _retryNamespaceForTesting(name: string): Promise<boolean> {
  const item = failedNamespaces.get(name);
  if (!item) return Promise.resolve(false);
  return loadSingleNamespace(item.def);
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
    authScreensTranslations,
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

  const [transVersion, setTransVersion] = useState(0);

  React.useEffect(() => {
    return subscribeToTranslationUpdates(() => {
      setTransVersion(v => v + 1);
    });
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    void transVersion;
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
  }, [language, transVersion]);

  const tp = useCallback((key: string, count: number): string => {
    void transVersion;
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
  }, [language, transVersion]);


  const tpFn = useCallback((key: string, count: number) => tp(key, count), [tp]);

  const [ready, setReady] = useState(() => Boolean(import.meta.env.VITEST && !_forceAsyncReadyForTesting));

  React.useEffect(() => {
    let cancelled = false;
    void whenTranslationsReady().then(() => {
      if (!cancelled) setReady(true);
    });
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

const defaultContextValue: LanguageContextType = {
  language: 'ru',
  setLanguage: () => {},
  t: (key: string, params?: Record<string, string | number>): string => {
    let str = translations[key]?.ru ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), () => String(v));
      });
    }
    return str;
  },
  tp: (key: string, count: number): string => {
    const mod10 = count % 10;
    const mod100 = count % 100;
    const suffix = (mod100 >= 11 && mod100 <= 14) ? '_many' : mod10 === 1 ? '_one' : (mod10 >= 2 && mod10 <= 4) ? '_few' : '_many';
    const fullKey = `${key}${suffix}`;
    const str = translations[fullKey]?.ru ?? translations[key]?.ru ?? key;
    return str.replace('{count}', () => String(count));
  },
};

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    return defaultContextValue;
  }
  return context;
}
