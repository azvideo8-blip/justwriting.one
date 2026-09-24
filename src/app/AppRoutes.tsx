import React, { Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { ProtectedRoute, GuestRoute } from './ProtectedRoute';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import type { AppUser } from '../core/auth/types';
import type { UserProfile } from '../shared/types/common';

const WritingPage = React.lazy(() => import('./pages/WritingPage').then(m => ({ default: m.WritingPage })));
const MobileMePage = React.lazy(() => import('./pages/MobileMePage').then(m => ({ default: m.MobileMePage })));
const ArchivePage = React.lazy(() => import('./pages/ArchivePage').then(m => ({ default: m.ArchivePage })));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const LoginPage = React.lazy(() => import('../features/auth/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const ResetPasswordPage = React.lazy(() => import('../features/auth/pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const AIPage = React.lazy(() => import('./pages/AIPage').then(m => ({ default: m.AIPage })));
const DiagnosticsPage = React.lazy(() => import('./pages/DiagnosticsPage').then(m => ({ default: m.DiagnosticsPage })));
const RerankBenchPage = React.lazy(() => import('../features/ai/pages/RerankBenchPage').then(m => ({ default: m.RerankBenchPage })));
const AboutPage = React.lazy(() => import('../features/navigation/pages/AboutPage').then(m => ({ default: m.AboutPage })));
const HelpPage = React.lazy(() => import('../features/navigation/pages/HelpPage').then(m => ({ default: m.HelpPage })));
const GuidePage = React.lazy(() => import('../features/navigation/pages/GuidePage').then(m => ({ default: m.GuidePage })));
const ChangelogPage = React.lazy(() => import('../features/navigation/pages/ChangelogPage').then(m => ({ default: m.ChangelogPage })));
const LandingPage = React.lazy(() => import('../features/navigation/pages/LandingPage').then(m => ({ default: m.LandingPage })));
const PrivacyPolicyPage = React.lazy(() => import('../features/navigation/pages/PrivacyPolicyPage').then(m => ({ default: m.PrivacyPolicyPage })));
const TermsOfServicePage = React.lazy(() => import('../features/navigation/pages/TermsOfServicePage').then(m => ({ default: m.TermsOfServicePage })));
const ConsentPage = React.lazy(() => import('../features/navigation/pages/ConsentPage').then(m => ({ default: m.ConsentPage })));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const NotFoundPage = React.lazy(() => import('../features/navigation/pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));

import { Loader2 } from 'lucide-react';

// [U-05] заменили "..." на анимированный спиннер
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <Loader2 size={24} className="animate-spin text-text-main/60" />
    </div>
  );
}

// AUDIT-M22: без scroll restoration навигация /archive → /changelog сохраняла
// позицию прокрутки предыдущей страницы.
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

// N-3 / F-05: GoTrue редиректит старые ссылки приглашений и сброса пароля (implicit grant)
// на корень сайта с хэшем `#access_token=...&type=invite`. Перенаправляем на /reset-password
// с сохранением хэша, чтобы пользователь увидел сообщение об устаревшем формате ссылки.
function AuthHashRedirect() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const hash = location.hash || (typeof window !== 'undefined' ? window.location.hash : '');
    if (hash && hash.includes('access_token=') && (hash.includes('type=invite') || hash.includes('type=recovery'))) {
      if (location.pathname !== '/reset-password') {
        void navigate({ pathname: '/reset-password', hash }, { replace: true });
      }
    }
  }, [location.pathname, location.hash, navigate]);

  return null;
}

function RootRoute({ user, profile }: { user: AppUser | null; profile: UserProfile | null }) {
  const location = useLocation();
  const hash = location.hash || (typeof window !== 'undefined' ? window.location.hash : '');
  if (hash && hash.includes('access_token=') && (hash.includes('type=invite') || hash.includes('type=recovery'))) {
    return <Navigate to={{ pathname: '/reset-password', hash }} replace />;
  }
  return <WritingPage user={user} profile={profile} />;
}

export function AppRoutes() {
  const { user, profile } = useAuthStatus();

  return (
    <ErrorBoundary>
    <ScrollToTop />
    <AuthHashRedirect />
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<ErrorBoundary><RootRoute user={user} profile={profile} /></ErrorBoundary>} />
        <Route path="/log" element={<Navigate to="/archive" replace />} />
        <Route path="/me" element={<ErrorBoundary><MobileMePage /></ErrorBoundary>} />
        <Route path="/archive" element={<ErrorBoundary><ArchivePage user={user} profile={profile} /></ErrorBoundary>} />
        <Route path="/profile" element={<ErrorBoundary><ProfilePage user={user} profile={profile} /></ErrorBoundary>} />
        <Route path="/ai" element={<ProtectedRoute><ErrorBoundary><AIPage /></ErrorBoundary></ProtectedRoute>} />
        <Route path="/rerank-bench" element={<ProtectedRoute requireAdmin><ErrorBoundary><RerankBenchPage /></ErrorBoundary></ProtectedRoute>} />
        <Route path="/diagnostics" element={<ProtectedRoute requireAdmin><ErrorBoundary><DiagnosticsPage /></ErrorBoundary></ProtectedRoute>} />
        <Route path="/admin" element={<Navigate to="/diagnostics" replace />} />
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        {/* Вне guarded-зон: сессия восстановления ещё не «настоящий» вход. */}
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/settings" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/guide/:page" element={<GuidePage />} />
        <Route path="/changelog" element={<ChangelogPage />} />
        <Route path="/features" element={<LandingPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsOfServicePage />} />
        <Route path="/consent" element={<ConsentPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
