import React, { useState } from 'react';
import { SettingsContext } from './SettingsContext';
import { SettingsPanel } from '../../features/settings/components/SettingsPanel';
import { useAuthStatus } from '../../features/auth/hooks/useAuthStatus';
import { getOrCreateGuestId } from '../../shared/lib/localDb';

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { user } = useAuthStatus();
  const userId = user?.uid ?? getOrCreateGuestId();

  return (
    <SettingsContext.Provider value={{ openSettings: () => setSettingsOpen(true) }}>
      {children}
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        userId={userId}
      />
    </SettingsContext.Provider>
  );
}
