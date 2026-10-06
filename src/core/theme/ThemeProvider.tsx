import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { z } from 'zod';
import { useLocalStorage } from '../../shared/hooks/useLocalStorage';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

export type ThemeId = 'modern' | 'notion' | 'spotify' | 'amethyst' | 'system';
export type ConcreteThemeId = Exclude<ThemeId, 'system'>;

const DARK_THEME: ConcreteThemeId = 'amethyst';
const LIGHT_THEME: ConcreteThemeId = 'notion';

export interface ThemeConfig {
  id: ConcreteThemeId;
  nameRu: string;
  nameEn: string;
  cssClass: string;
}

export const THEMES: Record<ConcreteThemeId, ThemeConfig> = {
  modern: {
    id: 'modern',
    nameRu: 'Современный',
    nameEn: 'Modern',
    cssClass: 'theme-modern',
  },
  notion: {
    id: 'notion',
    nameRu: 'Тёплый',
    nameEn: 'Warm',
    cssClass: 'theme-notion',
  },
  spotify: {
    id: 'spotify',
    nameRu: 'Энергия',
    nameEn: 'Energy',
    cssClass: 'theme-spotify',
  },
  amethyst: {
    id: 'amethyst',
    nameRu: 'Аметистовый',
    nameEn: 'Amethyst',
    cssClass: 'theme-amethyst',
  },
};

interface ThemeContextType {
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
  themes: typeof THEMES;
  resolvedThemeId: ConcreteThemeId;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useLocalStorage<ThemeId>(
    STORAGE_KEYS.APP_THEME,
    'amethyst',
    z.enum(['modern', 'notion', 'spotify', 'amethyst', 'system'])
  );

  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolvedThemeId: ConcreteThemeId =
    themeId === 'system'
      ? (systemPrefersDark ? DARK_THEME : LIGHT_THEME)
      : themeId;

  // useLayoutEffect, не useEffect: переключение темы идёт через View Transitions,
  // и снимок «после» берётся, когда колбэк уже вернулся. Пассивный эффект доехал бы
  // до класса позже — браузер сделал бы кроссфейд old→old и потом щёлкнул.
  useLayoutEffect(() => {
    const root = document.documentElement;
    Object.values(THEMES).forEach(t => root.classList.remove(t.cssClass));
    root.classList.add(THEMES[resolvedThemeId].cssClass);
  }, [resolvedThemeId]);

  const setThemeIdWithTransition = useCallback((id: ThemeId) => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof document.startViewTransition !== 'function' || reducedMotion) {
      setThemeId(id);
      return;
    }
    // Снимок «до» берётся на входе в startViewTransition, поэтому setState
    // обязан синхронно перекоммитить всё дерево до возврата из колбэка.
    document.startViewTransition(() => {
      flushSync(() => setThemeId(id));
    });
  }, [setThemeId]);

  const contextValue = useMemo(() => ({
    themeId,
    setThemeId: setThemeIdWithTransition,
    themes: THEMES,
    resolvedThemeId,
  }), [themeId, setThemeIdWithTransition, resolvedThemeId]);

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
