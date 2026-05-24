import React, { useState, useRef } from 'react';
import { SettingsContext } from './SettingsContext';
import { SettingsPanel } from '../../features/settings/components/SettingsPanel';
import { useAuthStatus } from '../../features/auth/hooks/useAuthStatus';
import { getOrCreateGuestId } from '../../shared/lib/localDb';

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultTab, setDefaultTab] = useState<'editor' | 'app' | 'account' | undefined>(undefined);
  const { user } = useAuthStatus();
  const userId = user?.uid ?? getOrCreateGuestId();
  const triggerRef = useRef<Element | null>(null);

  const openSettings = (tab?: 'editor' | 'app' | 'account' | unknown) => {
    const validTab = (tab === 'editor' || tab === 'app' || tab === 'account') ? tab : undefined;
    triggerRef.current = document.activeElement;
    setDefaultTab(validTab);
    setSettingsOpen(true);
  };

  const handleClose = () => {
    setSettingsOpen(false);
    (triggerRef.current as HTMLElement)?.focus();
  };

  return (
    <SettingsContext.Provider value={{ openSettings }}>
      {children}
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={handleClose}
        userId={userId}
        defaultTab={defaultTab}
      />
    </SettingsContext.Provider>
  );
}
