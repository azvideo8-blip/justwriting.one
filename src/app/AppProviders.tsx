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
import { getOrCreateGuestId } from '../core/storage/localDb';

// Resolves the auth-aware userId here so core's SettingsProvider stays free of
// feature imports (core must not import from features/).
function AuthAwareSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthStatus();
  const userId = user?.uid ?? getOrCreateGuestId();
  return (
    <SettingsProvider userId={userId} renderSettingsPanel={(props) => <SettingsPanel {...props} />}>
      {children}
    </SettingsProvider>
  );
}

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
                      <AuthAwareSettingsProvider>
                        <HelmetProvider>
                          <PrivacyGuard>
                            {children}
                          </PrivacyGuard>
                        </HelmetProvider>
                      </AuthAwareSettingsProvider>
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
