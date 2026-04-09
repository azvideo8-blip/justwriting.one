import React, { createContext, useContext, useEffect } from 'react';
import { z } from 'zod';
import { useLocalStorage } from '../../shared/hooks/useLocalStorage';

export type ThemeId = 'classic' | 'modern';

export interface ThemeConfig {
  id: ThemeId;
  nameRu: string;
  nameEn: string;
  cssClass: string;
}

export const THEMES: Record<ThemeId, ThemeConfig> = {
  classic: {
    id: 'classic',
    nameRu: 'Классический',
    nameEn: 'Classic',
    cssClass: 'theme-classic',
  },
  modern: {
    id: 'modern',
    nameRu: 'Современный',
    nameEn: 'Modern',
    cssClass: 'theme-modern',
  },
};

interface ThemeContextType {
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
  themes: typeof THEMES;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useLocalStorage<ThemeId>(
    'app-theme',
    'classic',
    z.enum(['classic', 'modern'])
  );

  useEffect(() => {
    const root = document.documentElement;
    Object.values(THEMES).forEach(t => root.classList.remove(t.cssClass));
    root.classList.add(THEMES[themeId].cssClass);
  }, [themeId]);

  return (
    <ThemeContext.Provider value={{ themeId, setThemeId, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
