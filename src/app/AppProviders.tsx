import { ThemeProvider } from '../core/theme/ThemeProvider';
import { WritingSettingsProvider } from '../features/writing/contexts/WritingSettingsContext';
import { SettingsProvider } from '../core/settings/SettingsProvider';
import { SettingsPanel } from '../features/settings/components/SettingsPanel';
import { LanguageProvider } from '../shared/i18n';
import { ToastProvider } from '../shared/components/Toast';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import { LoginModalProvider } from '../features/auth/contexts/LoginModalContext';
import { AuthProvider } from '../features/auth/contexts/AuthContext';
import { ProfileProvider } from '../features/auth/contexts/ProfileContext';
import { AnalyticsProvider } from '../features/auth/contexts/AnalyticsContext';
import { HelmetProvider } from 'react-helmet-async';
import { ReactNode } from 'react';
import { PrivacyModal, usePrivacyCheck } from '../features/auth/components/PrivacyModal';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';

function PrivacyGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthStatus();
  const { showPrivacy, setShowPrivacy } = usePrivacyCheck();

  return (
    <>
      {children}
      {isAuthenticated && showPrivacy && (
        <PrivacyModal onAccepted={() => setShowPrivacy(false)} />
      )}
    </>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ProfileProvider>
          <AnalyticsProvider>
            <LanguageProvider>
              <ThemeProvider>
                <WritingSettingsProvider>
                  <ToastProvider>
                    <LoginModalProvider>
                      <SettingsProvider renderSettingsPanel={(props) => <SettingsPanel {...props} />}>
                        <HelmetProvider>
                          <PrivacyGuard>
                            {children}
                          </PrivacyGuard>
                        </HelmetProvider>
                      </SettingsProvider>
                    </LoginModalProvider>
                  </ToastProvider>
                </WritingSettingsProvider>
              </ThemeProvider>
            </LanguageProvider>
          </AnalyticsProvider>
        </ProfileProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
