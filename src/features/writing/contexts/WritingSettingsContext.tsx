import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

interface WritingSettingsContextType {
  streamMode: boolean;
  toggleStreamMode: () => void;
  zenModeEnabled: boolean;
  setZenModeEnabled: (enabled: boolean) => void;
  isZenActive: boolean;
  status: 'idle' | 'writing' | 'paused' | 'finished';
  setStatus: (status: 'idle' | 'writing' | 'paused' | 'finished') => void;
}

const WritingSettingsContext = createContext<WritingSettingsContextType | undefined>(undefined);

export function WritingSettingsProvider({ children }: { children: React.ReactNode }) {
  const [streamMode, setStreamMode] = useState<boolean>(() => {
    return localStorage.getItem('streamMode') === 'true';
  });
  const [zenModeEnabled, setZenModeEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('v2_zenModeEnabled');
    return saved === null ? true : saved === 'true';
  });
  const [status, setStatus] = useState<'idle' | 'writing' | 'paused' | 'finished'>('idle');
  const [isZenActive, setIsZenActive] = useState<boolean>(false);
  const zenTimerRef = useRef<any>(null);

  useEffect(() => {
    localStorage.setItem('streamMode', streamMode.toString());
  }, [streamMode]);

  useEffect(() => {
    localStorage.setItem('v2_zenModeEnabled', zenModeEnabled.toString());
  }, [zenModeEnabled]);

  useEffect(() => {
    if (status !== 'writing' || !zenModeEnabled) {
      setIsZenActive(false);
      return;
    }

    const resetZenTimer = () => {
      setIsZenActive(false);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
      zenTimerRef.current = setTimeout(() => {
        setIsZenActive(true);
      }, 3000);
    };

    window.addEventListener('mousemove', resetZenTimer);
    window.addEventListener('keydown', resetZenTimer);

    resetZenTimer();

    return () => {
      window.removeEventListener('mousemove', resetZenTimer);
      window.removeEventListener('keydown', resetZenTimer);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
    };
  }, [status, zenModeEnabled]);

  const toggleStreamMode = () => setStreamMode(prev => !prev);

  return (
    <WritingSettingsContext.Provider value={{
      streamMode, toggleStreamMode,
      zenModeEnabled, setZenModeEnabled,
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
