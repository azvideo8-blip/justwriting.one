import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { z } from 'zod';
import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { TimerStatus } from '../store/types';

export interface HeaderVisibility {
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
  editorWidth: number;
  setEditorWidth: (width: number) => void;
  lifeLogEnabled: boolean;
  setLifeLogEnabled: (enabled: boolean) => void;
  lifeLogVisible: boolean;
  setLifeLogVisible: (v: boolean) => void;
  lifeLogTab: 'log' | 'settings';
  setLifeLogTab: (tab: 'log' | 'settings') => void;
  isZenActive: boolean;
  zenSeenOnce: boolean;
  status: TimerStatus;
  setStatus: (status: TimerStatus) => void;
  fontFamily: string;
  setFontFamily: (font: string) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  lifeLogPinned: boolean;
  setLifeLogPinned: (enabled: boolean) => void;
  headerVisibility: HeaderVisibility;
  toggleVisibility: (key: keyof HeaderVisibility) => void;
  typewriterScrolling: boolean;
  setTypewriterScrolling: (enabled: boolean) => void;
  focusModeEnabled: boolean;
  setFocusModeEnabled: (enabled: boolean) => void;
  autoHideCursor: boolean;
  setAutoHideCursor: (enabled: boolean) => void;
  lineHeight: number;
  setLineHeight: (lh: number) => void;
}

const WritingSettingsContext = createContext<WritingSettingsContextType | undefined>(undefined);

export function WritingSettingsProvider({ children }: { children: React.ReactNode }) {
  const [streamMode, setStreamMode] = useLocalStorage<boolean>('streamMode', false, z.boolean());
  const [zenModeEnabled, setZenModeEnabled] = useLocalStorage<boolean>('v2_zenModeEnabled', true, z.boolean());
  const [editorWidth, setEditorWidth] = useLocalStorage<number>('v3_editorWidth', 68, z.number());
  const [lifeLogEnabled, setLifeLogEnabled] = useLocalStorage<boolean>('lifeLogEnabled', true, z.boolean());
  const [lifeLogVisible, setLifeLogVisible] = useState(false);
  const [lifeLogTab, setLifeLogTab] = useState<'log' | 'settings'>('log');
  const [fontFamily, setFontFamily] = useLocalStorage<string>('v2_fontFamily', 'Inter', z.string());
  const [fontSize, setFontSize] = useLocalStorage<number>('v2_fontSize', 18, z.number());
  const [lineHeight, setLineHeight] = useLocalStorage<number>('v2_lineHeight', 1.6, z.number());
  const [lifeLogPinned, setLifeLogPinned] = useLocalStorage<boolean>('v3_lifeLogPinned', false, z.boolean());
  const [typewriterScrolling, setTypewriterScrolling] = useLocalStorage<boolean>('v2_typewriterScrolling', false, z.boolean());
  const [focusModeEnabled, setFocusModeEnabled] = useLocalStorage<boolean>('v2_focusModeEnabled', false, z.boolean());
  const [autoHideCursor, setAutoHideCursor] = useLocalStorage<boolean>('v2_autoHideCursor', false, z.boolean());
  const [headerVisibility, setHeaderVisibility] = useLocalStorage<HeaderVisibility>(
    'v2_headerVisibility',
    { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    z.object({ sessionTime: z.boolean(), sessionWords: z.boolean(), totalWords: z.boolean(), wpm: z.boolean() })
  );

  const [status, setStatus] = useState<TimerStatus>('idle');
  const [isZenActive, setIsZenActive] = useState<boolean>(false);
  const [zenSeenOnce, setZenSeenOnce] = useLocalStorage<boolean>('zen_seen_once', false, z.boolean());
  const zenSeenOnceRef = useRef(zenSeenOnce);
  const zenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardRef = useRef<boolean>(false);
  const lastMousePos = useRef<{ x: number; y: number }>({ x: -1, y: -1 });

  useEffect(() => {
    if (status !== 'writing' || !zenModeEnabled) {
      guardRef.current = false;
      const timer = setTimeout(() => {
        setIsZenActive(false);
      }, 0);
      return () => clearTimeout(timer);
    }

    guardRef.current = false;
    let lastMoveTime = 0;
    const showUI = (e: MouseEvent | TouchEvent) => {
      if (guardRef.current) return;
      const now = Date.now();
      if (now - lastMoveTime < 200) return;
      lastMoveTime = now;

      const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0]?.clientY : e.clientY;

      if (clientX !== undefined && clientY !== undefined) {
        if (clientX === lastMousePos.current.x && clientY === lastMousePos.current.y) return;
        lastMousePos.current = { x: clientX, y: clientY };
      }

      setIsZenActive(false);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
      zenTimerRef.current = setTimeout(() => setIsZenActive(true), 3000);
    };

     const hideUI = () => {
       setIsZenActive(true);
       if (!zenSeenOnceRef.current) setZenSeenOnce(true);
       if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
    };

    window.addEventListener('mousemove', showUI);
    window.addEventListener('keydown', hideUI);
    window.addEventListener('touchstart', showUI, { passive: true });

    const timer = setTimeout(() => setIsZenActive(true), 300);

    return () => {
      window.removeEventListener('mousemove', showUI);
      window.removeEventListener('keydown', hideUI);
      window.removeEventListener('touchstart', showUI);
      clearTimeout(timer);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
    };
  }, [status, zenModeEnabled, setZenSeenOnce]);

  const toggleStreamMode = useCallback(() => setStreamMode(prev => !prev), [setStreamMode]);
  const toggleVisibility = useCallback((key: keyof HeaderVisibility) => {
    setHeaderVisibility((prev: HeaderVisibility) => ({ ...prev, [key]: !prev[key] }));
  }, [setHeaderVisibility]);

  const contextValue = useMemo(() => ({
    streamMode, toggleStreamMode,
    zenModeEnabled, setZenModeEnabled,
    editorWidth, setEditorWidth,
    lifeLogEnabled, setLifeLogEnabled,
    lifeLogVisible, setLifeLogVisible,
    lifeLogTab, setLifeLogTab,
    isZenActive,
    zenSeenOnce,
    status, setStatus,
    fontFamily, setFontFamily,
    fontSize, setFontSize,
    lifeLogPinned, setLifeLogPinned,
    headerVisibility, toggleVisibility,
    typewriterScrolling, setTypewriterScrolling,
    focusModeEnabled, setFocusModeEnabled,
    autoHideCursor, setAutoHideCursor,
    lineHeight, setLineHeight,
  }), [streamMode, toggleStreamMode, zenModeEnabled, setZenModeEnabled, editorWidth, setEditorWidth, lifeLogEnabled, setLifeLogEnabled, lifeLogVisible, setLifeLogVisible, lifeLogTab, setLifeLogTab, isZenActive, zenSeenOnce, status, setStatus, fontFamily, setFontFamily, fontSize, setFontSize, lifeLogPinned, setLifeLogPinned, headerVisibility, toggleVisibility, typewriterScrolling, setTypewriterScrolling, focusModeEnabled, setFocusModeEnabled, autoHideCursor, setAutoHideCursor, lineHeight, setLineHeight]);

  return (
    <WritingSettingsContext.Provider value={contextValue}>
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
