import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuthStatus();

  // Ждём пока загрузится и auth И профиль
  // Если user есть, но profile еще null — значит профиль еще грузится
  if (loading || (user && profile === null)) return null;

  // Если user нет или роль не admin — редиректим
  if (!user || profile?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
