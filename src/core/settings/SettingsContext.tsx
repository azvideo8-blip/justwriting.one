import { createContext, useContext } from 'react';

export const SettingsContext = createContext<{
  openSettings: (tab?: 'editor' | 'app' | 'account') => void;
  // Lets a screen (e.g. the writing editor) take over "open settings" so it can dock
  // the settings into its own layout instead of the global overlay. Pass null to clear.
  registerOpenOverride: (fn: ((tab?: 'editor' | 'app' | 'account') => void) | null) => void;
}>({ openSettings: () => {}, registerOpenOverride: () => {} });
export const useSettings = () => useContext(SettingsContext);
