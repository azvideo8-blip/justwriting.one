import React, { useState, useRef, useCallback } from 'react';
import { SettingsContext } from './SettingsContext';

interface SettingsProviderProps {
  children: React.ReactNode;
  userId: string;
  renderSettingsPanel: (props: { isOpen: boolean; onClose: () => void; userId: string; defaultTab?: string | undefined }) => React.ReactNode;
}

export function SettingsProvider({ children, userId, renderSettingsPanel }: SettingsProviderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultTab, setDefaultTab] = useState<string | undefined>(undefined);
  const triggerRef = useRef<Element | null>(null);
  const openOverrideRef = useRef<((target?: string) => void) | null>(null);

  const registerOpenOverride = useCallback((fn: ((target?: string) => void) | null) => {
    openOverrideRef.current = fn;
  }, []);

  const openSettings = (target?: string | unknown) => {
    const targetStr = typeof target === 'string' ? target : undefined;

    // If a specific section on the settings page is requested, navigate there:
    if (targetStr && targetStr !== 'editor') {
      const sectionMap: Record<string, string> = {
        app: 'sync',
        storage: 'sync',
        sync: 'sync',
        account: 'account',
        security: 'security',
        vault: 'security',
        encryption: 'security',
        ai: 'security',
        backup: 'backup',
        export: 'backup',
        about: 'about',
        danger: 'danger',
      };
      const sectionId = sectionMap[targetStr] || targetStr;
      if (typeof window !== 'undefined') {
        if (window.location.pathname === '/settings') {
          window.location.hash = sectionId;
          const el = document.getElementById(sectionId);
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          window.location.href = `/settings#${sectionId}`;
        }
      }
      return;
    }

    if (openOverrideRef.current) {
      openOverrideRef.current(targetStr);
      return;
    }
    triggerRef.current = document.activeElement;
    setDefaultTab(targetStr);
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
