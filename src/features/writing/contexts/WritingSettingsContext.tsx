import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { z } from 'zod';
import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';

interface WritingSettingsContextType {
  streamMode: boolean;
  toggleStreamMode: () => void;
  zenModeEnabled: boolean;
  setZenModeEnabled: (enabled: boolean) => void;
  textWidth: 'centered' | 'full';
  setTextWidth: (width: 'centered' | 'full') => void;
  isZenActive: boolean;
  status: 'idle' | 'writing' | 'paused' | 'finished';
  setStatus: (status: 'idle' | 'writing' | 'paused' | 'finished') => void;
}

const WritingSettingsContext = createContext<WritingSettingsContextType | undefined>(undefined);

export function WritingSettingsProvider({ children }: { children: React.ReactNode }) {
  const [streamMode, setStreamMode] = useLocalStorage<boolean>(
    'streamMode', 
    false,
    z.boolean()
  );
  const [zenModeEnabled, setZenModeEnabled] = useLocalStorage<boolean>(
    'v2_zenModeEnabled', 
    true,
    z.boolean()
  );
  const [textWidth, setTextWidth] = useLocalStorage<'centered' | 'full'>(
    'textWidth',
    'centered',
    z.enum(['centered', 'full'])
  );
  const [status, setStatus] = useState<'idle' | 'writing' | 'paused' | 'finished'>('idle');
  const [isZenActive, setIsZenActive] = useState<boolean>(false);
  const zenTimerRef = useRef<any>(null);

  useEffect(() => {
    if (status !== 'writing' || !zenModeEnabled) {
      setIsZenActive(false);
      return;
    }

    const showUI = () => {
      setIsZenActive(false);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
      zenTimerRef.current = setTimeout(() => {
        setIsZenActive(true);
      }, 3000);
    };

    const hideUI = () => {
      setIsZenActive(true);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
    };

    window.addEventListener('mousemove', showUI);
    window.addEventListener('keydown', hideUI);

    // Initial state: hidden if writing
    setIsZenActive(true);

    return () => {
      window.removeEventListener('mousemove', showUI);
      window.removeEventListener('keydown', hideUI);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
    };
  }, [status, zenModeEnabled]);

  const toggleStreamMode = () => setStreamMode(prev => !prev);

  return (
    <WritingSettingsContext.Provider value={{
      streamMode, toggleStreamMode,
      zenModeEnabled, setZenModeEnabled,
      textWidth, setTextWidth,
      isZenActive,
      status, setStatus
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
