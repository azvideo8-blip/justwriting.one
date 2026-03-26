import React, { createContext, useContext, useState, useEffect } from 'react';

type UIVersion = '1.0' | '2.0';

interface UIContextType {
  uiVersion: UIVersion;
  toggleUIVersion: () => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [uiVersion, setUIVersion] = useState<UIVersion>(() => {
    return (localStorage.getItem('uiVersion') as UIVersion) || '1.0';
  });

  useEffect(() => {
    localStorage.setItem('uiVersion', uiVersion);
    if (uiVersion === '2.0') {
      document.documentElement.classList.add('theme-v2');
    } else {
      document.documentElement.classList.remove('theme-v2');
    }
  }, [uiVersion]);

  const toggleUIVersion = () => {
    setUIVersion(prev => (prev === '1.0' ? '2.0' : '1.0'));
  };

  return (
    <UIContext.Provider value={{ uiVersion, toggleUIVersion }}>
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
