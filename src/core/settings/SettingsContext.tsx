import { createContext, useContext } from 'react';

export const SettingsContext = createContext<{ openSettings: () => void }>({ openSettings: () => {} });
export const useSettings = () => useContext(SettingsContext);
