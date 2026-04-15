import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { z } from 'zod';
import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';

interface HeaderVisibility {
  currentTime: boolean;
  sessionTime: boolean;
  sessionWords: boolean;
  totalWords: boolean;
  wpm: boolean;
}

interface WritingSettingsContextType {
  streamMode: boolean;
  toggleStreamMode: () => void;
  zenModeEnabled: boolean;
  setZenModeEnabled: (enabled: boolean) => void;
  textWidth: number;
  setTextWidth: (width: number) => void;
  isZenActive: boolean;
  status: 'idle' | 'writing' | 'paused' | 'finished';
  setStatus: (status: 'idle' | 'writing' | 'paused' | 'finished') => void;
  fontFamily: string;
  setFontFamily: (font: string) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  stickyHeader: boolean;
  setStickyHeader: (enabled: boolean) => void;
  stickyPanel: boolean;
  setStickyPanel: (enabled: boolean) => void;
  headerVisibility: HeaderVisibility;
  toggleVisibility: (key: keyof HeaderVisibility) => void;
  showTitle: boolean;
  setShowTitle: (v: boolean) => void;
  showPinnedThoughts: boolean;
  setShowPinnedThoughts: (v: boolean) => void;
}

const WritingSettingsContext = createContext<WritingSettingsContextType | undefined>(undefined);

export function WritingSettingsProvider({ children }: { children: React.ReactNode }) {
  const [streamMode, setStreamMode] = useLocalStorage<boolean>('streamMode', false, z.boolean());
  const [zenModeEnabled, setZenModeEnabled] = useLocalStorage<boolean>('v2_zenModeEnabled', true, z.boolean());
  const [textWidth, setTextWidth] = useLocalStorage<number>('v2_textWidth_px', 720, z.number());
  const [fontFamily, setFontFamily] = useLocalStorage<string>('v2_fontFamily', 'Inter', z.string());
  const [fontSize, setFontSize] = useLocalStorage<number>('v2_fontSize', 18, z.number());
  const [stickyHeader, setStickyHeader] = useLocalStorage<boolean>('v2_stickyHeaderEnabled', true, z.boolean());
  const [stickyPanel, setStickyPanel] = useLocalStorage<boolean>('stickyPanel', true, z.boolean());
  const [showTitle, setShowTitle] = useLocalStorage<boolean>('editor-show-title', true, z.boolean());
  const [showPinnedThoughts, setShowPinnedThoughts] = useLocalStorage<boolean>('editor-show-pinned', true, z.boolean());
  const [headerVisibility, setHeaderVisibility] = useLocalStorage<HeaderVisibility>(
    'v2_headerVisibility',
    { currentTime: true, sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    z.object({ currentTime: z.boolean(), sessionTime: z.boolean(), sessionWords: z.boolean(), totalWords: z.boolean(), wpm: z.boolean() })
  );

  const [status, setStatus] = useState<'idle' | 'writing' | 'paused' | 'finished'>('idle');
  const [isZenActive, setIsZenActive] = useState<boolean>(false);
  const zenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardRef = useRef<boolean>(false);
  const lastMousePos = useRef<{ x: number; y: number }>({ x: -1, y: -1 });

  useEffect(() => {
    if (status !== 'writing' || !zenModeEnabled) {
      const timer = setTimeout(() => {
        setIsZenActive(false);
      }, 0);
      return () => clearTimeout(timer);
    }

    const showUI = (e: MouseEvent) => {
      if (guardRef.current) return;
      if (e.clientX === lastMousePos.current.x && e.clientY === lastMousePos.current.y) return;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      setIsZenActive(false);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
      zenTimerRef.current = setTimeout(() => setIsZenActive(true), 3000);
    };

    const hideUI = () => {
      setIsZenActive(true);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
    };

    window.addEventListener('mousemove', showUI);
    window.addEventListener('keydown', hideUI);

    const timer = setTimeout(() => setIsZenActive(true), 300);

    return () => {
      window.removeEventListener('mousemove', showUI);
      window.removeEventListener('keydown', hideUI);
      clearTimeout(timer);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
    };
  }, [status, zenModeEnabled]);

  const toggleStreamMode = () => setStreamMode(prev => !prev);
  const toggleVisibility = (key: keyof HeaderVisibility) => {
    setHeaderVisibility((prev: HeaderVisibility) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <WritingSettingsContext.Provider value={{
      streamMode, toggleStreamMode,
      zenModeEnabled, setZenModeEnabled,
      textWidth, setTextWidth,
      isZenActive,
      status, setStatus,
      fontFamily, setFontFamily,
      fontSize, setFontSize,
      stickyHeader, setStickyHeader,
      stickyPanel, setStickyPanel,
      headerVisibility, toggleVisibility,
      showTitle, setShowTitle,
      showPinnedThoughts, setShowPinnedThoughts,
    }}>
      {children}
    </WritingSettingsContext.Provider>
  );
}

export function useWritingSettings() {
  const context = useContext(WritingSettingsContext);
  if (context === undefined) {
    throw new Error('useWritingSettings must be used within a WritingSettingsProvider');
  }
  return context;
}
