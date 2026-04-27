import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { useLoginModal } from '../features/auth/contexts/LoginModalContext';
import { useLanguage } from '../core/i18n';
import { LogIn } from 'lucide-react';

export function ProtectedRoute({ children, requireAdmin }: { children: React.ReactNode; requireAdmin?: boolean }) {
  const { isAuthenticated, profile, loading } = useAuthStatus();
  const { openLoginModal } = useLoginModal();
  const { t } = useLanguage();

  if (loading) return null;

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <div className="w-12 h-12 rounded-full flex items-center justify-center bg-text-main/10 text-text-main/40">
          <LogIn size={24} />
        </div>
        <div className="text-lg font-medium text-text-main/70">
          {t('auth_required_title')}
        </div>
        <div className="text-sm text-text-main/40 text-center max-w-xs">
          {t('auth_required_hint')}
        </div>
        <button
          onClick={openLoginModal}
          className="px-6 py-2.5 rounded-xl bg-text-main text-surface-base text-sm font-medium hover:scale-105 transition-transform"
        >
          {t('auth_sign_in')}
        </button>
      </div>
    );
  }

  if (requireAdmin && profile?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export function GuestRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuthStatus();

  if (loading) return null;
  if (isAuthenticated) return <Navigate to="/" replace />;

  return <>{children}</>;
}
