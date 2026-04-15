import React, { useState } from 'react';
import { SettingsContext } from './SettingsContext';
import { SettingsPanel } from '../../features/settings/components/SettingsPanel';
import { useAuthStatus } from '../../features/auth/hooks/useAuthStatus';

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { user } = useAuthStatus();

  return (
    <SettingsContext.Provider value={{ openSettings: () => setSettingsOpen(true) }}>
      {children}
      {user && (
        <SettingsPanel
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          userId={user.uid}
        />
      )}
    </SettingsContext.Provider>
  );
}
