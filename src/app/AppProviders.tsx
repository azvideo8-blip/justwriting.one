import { ThemeProvider } from '../core/theme/ThemeProvider';
import { WritingSettingsProvider } from '../features/writing/contexts/WritingSettingsContext';
import { SettingsProvider } from '../core/settings/SettingsProvider';
import { LanguageProvider } from '../core/i18n';
import { ToastProvider } from '../shared/components/Toast';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import { ReactNode } from 'react';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <ThemeProvider>
          <WritingSettingsProvider>
            <ToastProvider>
              <SettingsProvider>
                {children}
              </SettingsProvider>
            </ToastProvider>
          </WritingSettingsProvider>
        </ThemeProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
