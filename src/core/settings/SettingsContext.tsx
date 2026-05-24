import { createContext, useContext } from 'react';

export const SettingsContext = createContext<{
  openSettings: (tab?: 'editor' | 'app' | 'account') => void;
}>({ openSettings: () => {} });
export const useSettings = () => useContext(SettingsContext);
