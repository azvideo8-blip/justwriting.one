import { ThemeProvider } from '../core/theme/ThemeProvider';
import { WritingSettingsProvider } from '../features/writing/contexts/WritingSettingsContext';
import { SettingsProvider } from '../core/settings/SettingsProvider';
import { LanguageProvider } from '../core/i18n';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import { ReactNode } from 'react';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <ThemeProvider>
          <WritingSettingsProvider>
            <SettingsProvider>
              {children}
            </SettingsProvider>
          </WritingSettingsProvider>
        </ThemeProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
