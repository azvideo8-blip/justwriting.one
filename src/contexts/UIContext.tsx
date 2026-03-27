import React, { createContext, useContext, useState, useEffect } from 'react';

type UIVersion = '1.0' | '2.0';

interface UIContextType {
  uiVersion: UIVersion;
  toggleUIVersion: () => void;
  streamMode: boolean;
  toggleStreamMode: () => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [uiVersion, setUIVersion] = useState<UIVersion>(() => {
    return (localStorage.getItem('uiVersion') as UIVersion) || '1.0';
  });
  const [streamMode, setStreamMode] = useState<boolean>(() => {
    return localStorage.getItem('streamMode') === 'true';
  });

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

  const toggleUIVersion = () => {
    setUIVersion(prev => (prev === '1.0' ? '2.0' : '1.0'));
  };

  const toggleStreamMode = () => {
    setStreamMode(prev => !prev);
  };

  return (
    <UIContext.Provider value={{ uiVersion, toggleUIVersion, streamMode, toggleStreamMode }}>
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
