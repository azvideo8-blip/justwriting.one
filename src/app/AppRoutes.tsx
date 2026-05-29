import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { ProtectedRoute, GuestRoute } from './ProtectedRoute';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';

const WritingPage = React.lazy(() => import('../features/writing/pages/WritingPage').then(m => ({ default: m.WritingPage })));
const MobileMePage = React.lazy(() => import('../features/writing/pages/MobileMePage').then(m => ({ default: m.MobileMePage })));
const ArchivePage = React.lazy(() => import('../features/archive/pages/ArchivePage').then(m => ({ default: m.ArchivePage })));
const ProfilePage = React.lazy(() => import('../features/profile/pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const LoginPage = React.lazy(() => import('../features/auth/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const AIPage = React.lazy(() => import('../features/ai/pages/AIPage').then(m => ({ default: m.AIPage })));
const DiagnosticsPage = React.lazy(() => import('../features/ai/pages/DiagnosticsPage').then(m => ({ default: m.DiagnosticsPage })));
const AboutPage = React.lazy(() => import('../features/navigation/pages/AboutPage').then(m => ({ default: m.AboutPage })));
const ChangelogPage = React.lazy(() => import('../features/navigation/pages/ChangelogPage').then(m => ({ default: m.ChangelogPage })));
const LandingPage = React.lazy(() => import('../features/navigation/pages/LandingPage').then(m => ({ default: m.LandingPage })));

import { Loader2 } from 'lucide-react';

// [U-05] заменили "..." на анимированный спиннер
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <Loader2 size={24} className="animate-spin text-text-main/30" />
    </div>
  );
}

export function AppRoutes() {
  const { user, profile } = useAuthStatus();

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<ErrorBoundary><WritingPage user={user} profile={profile} /></ErrorBoundary>} />
        <Route path="/log" element={<Navigate to="/archive" replace />} />
        <Route path="/me" element={<ErrorBoundary><MobileMePage /></ErrorBoundary>} />
        <Route path="/archive" element={<ErrorBoundary><ArchivePage user={user} profile={profile} /></ErrorBoundary>} />
        <Route path="/profile" element={<ErrorBoundary><ProfilePage user={user} profile={profile} /></ErrorBoundary>} />
        <Route path="/ai" element={<ProtectedRoute><ErrorBoundary><AIPage /></ErrorBoundary></ProtectedRoute>} />
        <Route path="/diagnostics" element={<ProtectedRoute requireAdmin><ErrorBoundary><DiagnosticsPage /></ErrorBoundary></ProtectedRoute>} />
        <Route path="/admin" element={<Navigate to="/diagnostics" replace />} />
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/changelog" element={<ChangelogPage />} />
        <Route path="/features" element={<LandingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
