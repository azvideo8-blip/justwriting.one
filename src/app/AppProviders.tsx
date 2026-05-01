import { ThemeProvider } from '../core/theme/ThemeProvider';
import { WritingSettingsProvider } from '../features/writing/contexts/WritingSettingsContext';
import { SettingsProvider } from '../core/settings/SettingsProvider';
import { LanguageProvider } from '../core/i18n';
import { ToastProvider } from '../shared/components/Toast';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import { LoginModalProvider } from '../features/auth/contexts/LoginModalContext';
import { AuthProvider } from '../features/auth/contexts/AuthContext';
import { ReactNode } from 'react';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <LanguageProvider>
          <ThemeProvider>
            <WritingSettingsProvider>
              <ToastProvider>
                <LoginModalProvider>
                  <SettingsProvider>
                    {children}
                  </SettingsProvider>
                </LoginModalProvider>
              </ToastProvider>
            </WritingSettingsProvider>
          </ThemeProvider>
        </LanguageProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
