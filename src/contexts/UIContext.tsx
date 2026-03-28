import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

type UIVersion = '1.0' | '2.0';

interface UIContextType {
  uiVersion: UIVersion;
  toggleUIVersion: () => void;
  streamMode: boolean;
  toggleStreamMode: () => void;
  isZenActive: boolean;
  setIsZenActive: (active: boolean) => void;
  zenModeEnabled: boolean;
  setZenModeEnabled: (enabled: boolean) => void;
  status: 'idle' | 'writing' | 'paused' | 'finished';
  setStatus: (status: 'idle' | 'writing' | 'paused' | 'finished') => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [uiVersion, setUIVersion] = useState<UIVersion>(() => {
    return (localStorage.getItem('uiVersion') as UIVersion) || '1.0';
  });
  const [streamMode, setStreamMode] = useState<boolean>(() => {
    return localStorage.getItem('streamMode') === 'true';
  });
  const [isZenActive, setIsZenActive] = useState<boolean>(false);
  const [zenModeEnabled, setZenModeEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('writing_zenModeEnabled');
    return saved === null ? true : saved === 'true';
  });
  const [status, setStatus] = useState<'idle' | 'writing' | 'paused' | 'finished'>('idle');
  const zenTimerRef = useRef<any>(null);

  useEffect(() => {
    localStorage.setItem('uiVersion', uiVersion);
    if (uiVersion === '2.0') {
      document.documentElement.classList.add('theme-v2');
    } else {
      document.documentElement.classList.remove('theme-v2');
    }
  }, [uiVersion]);

  useEffect(() => {
    localStorage.setItem('streamMode', streamMode.toString());
  }, [streamMode]);

  useEffect(() => {
    localStorage.setItem('writing_zenModeEnabled', zenModeEnabled.toString());
    if (!zenModeEnabled) {
      setIsZenActive(false);
    }
  }, [zenModeEnabled]);

  // Zen Mode Logic
  useEffect(() => {
    if (status !== 'writing' || !zenModeEnabled) {
      setIsZenActive(false);
      return;
    }
    
    // Ensure it's active when writing starts
    setIsZenActive(true);

    const handleActivity = () => {
      if (!zenModeEnabled) {
        if (isZenActive) setIsZenActive(false);
        return;
      }
      setIsZenActive(true);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
      zenTimerRef.current = setTimeout(() => {
        setIsZenActive(false);
      }, 5000); // Increased to 5s
    };

    window.addEventListener('keydown', handleActivity);
    return () => {
      window.removeEventListener('keydown', handleActivity);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
    };
  }, [status, zenModeEnabled]);

  const toggleUIVersion = () => {
    setUIVersion(prev => (prev === '1.0' ? '2.0' : '1.0'));
  };

  const toggleStreamMode = () => {
    setStreamMode(prev => !prev);
  };

  return (
    <UIContext.Provider value={{ uiVersion, toggleUIVersion, streamMode, toggleStreamMode, isZenActive, setIsZenActive, zenModeEnabled, setZenModeEnabled, status, setStatus }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const context = useContext(UIContext);
  if (context === undefined) {
    throw new Error('useUI must be used within a UIProvider');
  }
  return context;
}
