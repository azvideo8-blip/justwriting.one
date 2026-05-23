import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { ProtectedRoute, GuestRoute } from './ProtectedRoute';

const WritingPage = React.lazy(() => import('../features/writing/pages/WritingPage').then(m => ({ default: m.WritingPage })));
const MobileLogPage = React.lazy(() => import('../features/writing/pages/MobileLogPage').then(m => ({ default: m.MobileLogPage })));
const MobileMePage = React.lazy(() => import('../features/writing/pages/MobileMePage').then(m => ({ default: m.MobileMePage })));
const ArchivePage = React.lazy(() => import('../features/archive/pages/ArchivePage').then(m => ({ default: m.ArchivePage })));
const ProfilePage = React.lazy(() => import('../features/profile/pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const AdminPage = React.lazy(() => import('../features/admin/pages/AdminPage').then(m => ({ default: m.AdminPage })));
const LoginPage = React.lazy(() => import('../features/auth/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const AboutPage = React.lazy(() => import('../features/navigation/pages/AboutPage').then(m => ({ default: m.AboutPage })));

import { Loader2 } from 'lucide-react';

// [U-05] \u0437\u0430\u043c\u0435\u043d\u0438\u043b\u0438 "..." \u043d\u0430 \u0430\u043d\u0438\u043c\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439 \u0441\u043f\u0438\u043d\u043d\u0435\u0440
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
        <Route path="/" element={<WritingPage user={user} profile={profile} />} />
        <Route path="/log" element={<MobileLogPage />} />
        <Route path="/me" element={<MobileMePage />} />
        <Route path="/archive" element={<ArchivePage user={user} profile={profile} />} />
        <Route path="/profile" element={<ProfilePage user={user} profile={profile} />} />
        <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminPage /></ProtectedRoute>} />
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
