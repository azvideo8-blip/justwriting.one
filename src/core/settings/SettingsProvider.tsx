import React, { useState, useRef, useCallback } from 'react';
import { SettingsContext } from './SettingsContext';

interface SettingsProviderProps {
  children: React.ReactNode;
  userId: string;
  renderSettingsPanel: (props: { isOpen: boolean; onClose: () => void; userId: string; defaultTab: 'editor' | 'app' | 'account' | undefined }) => React.ReactNode;
}

export function SettingsProvider({ children, userId, renderSettingsPanel }: SettingsProviderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultTab, setDefaultTab] = useState<'editor' | 'app' | 'account' | undefined>(undefined);
  const triggerRef = useRef<Element | null>(null);
  const openOverrideRef = useRef<((tab?: 'editor' | 'app' | 'account') => void) | null>(null);

  const registerOpenOverride = useCallback((fn: ((tab?: 'editor' | 'app' | 'account') => void) | null) => {
    openOverrideRef.current = fn;
  }, []);

  const openSettings = (tab?: 'editor' | 'app' | 'account' | unknown) => {
    const validTab = (tab === 'editor' || tab === 'app' || tab === 'account') ? tab : undefined;
    if (openOverrideRef.current) {
      openOverrideRef.current(validTab);
      return;
    }
    triggerRef.current = document.activeElement;
    setDefaultTab(validTab);
    setSettingsOpen(true);
  };

  const handleClose = () => {
    setSettingsOpen(false);
    (triggerRef.current as HTMLElement)?.focus();
  };

  return (
    <SettingsContext.Provider value={{ openSettings, registerOpenOverride }}>
      {children}
      {/* eslint-disable-next-line react-hooks/refs -- settingsOpen is state, not a ref */}
      {renderSettingsPanel({ isOpen: settingsOpen, onClose: handleClose, userId, defaultTab })}
    </SettingsContext.Provider>
  );
}
