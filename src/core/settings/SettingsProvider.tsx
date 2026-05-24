import React, { useState } from 'react';
import { SettingsContext } from './SettingsContext';
import { SettingsPanel } from '../../features/settings/components/SettingsPanel';
import { useAuthStatus } from '../../features/auth/hooks/useAuthStatus';
import { getOrCreateGuestId } from '../../shared/lib/localDb';

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultTab, setDefaultTab] = useState<'editor' | 'app' | 'account' | undefined>(undefined);
  const { user } = useAuthStatus();
  const userId = user?.uid ?? getOrCreateGuestId();

  const openSettings = (tab?: 'editor' | 'app' | 'account') => {
    setDefaultTab(tab);
    setSettingsOpen(true);
  };

  return (
    <SettingsContext.Provider value={{ openSettings }}>
      {children}
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        userId={userId}
        defaultTab={defaultTab}
      />
    </SettingsContext.Provider>
  );
}
