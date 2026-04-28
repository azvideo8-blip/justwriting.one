import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import { AdminUserService } from '../services/AdminUserService';
import { AdminSessionService } from '../services/AdminSessionService';
import { auth } from '../../../core/firebase/auth';
import { Users, Database, Shield, AlertTriangle } from 'lucide-react';
import { AdminUsersTable } from '../components/AdminUsersTable';
import { AdminSessionsTable } from '../components/AdminSessionsTable';
import { useLanguage } from '../../../core/i18n';
import { useServiceAction } from '../../writing/hooks/useServiceAction';
import { cn } from '../../../core/utils/utils';

import { Session, UserProfile } from '../../../types';
import { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { CancelConfirmModal } from '../../writing/components/modals/CancelConfirmModal';
import { LoadingSpinner } from '../../../shared/components/LoadingSpinner';

export function AdminPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const lastSessionDocRef = useRef<QueryDocumentSnapshot<DocumentData, DocumentData> | null>(null);
  const [hasMoreSessions, setHasMoreSessions] = useState(true);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'sessions' | 'security'>('users');
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const { t } = useLanguage();
  const { execute } = useServiceAction();

  const fetchData = useCallback(async (isInitial = true) => {
    if (isInitial) {
      setLoading(true);
      lastSessionDocRef.current = null;
    } else {
      setLoadingMoreSessions(true);
    }
    
    try {
      if (activeTab === 'users') {
        const usersData = await AdminUserService.getUsers(50);
        setUsers(usersData);
      } else if (activeTab === 'sessions') {
        const result = await AdminSessionService.getAllSessionsAdmin(
          20,
          isInitial ? undefined : lastSessionDocRef.current
        );
        if (isInitial) {
          setSessions(result.sessions);
        } else {
          setSessions(prev => [...prev, ...result.sessions]);
        }
        lastSessionDocRef.current = result.lastDoc;
        setHasMoreSessions(result.sessions.length === 20);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("Admin fetch error:", err);
    } finally {
      setLoading(false);
      setLoadingMoreSessions(false);
    }
  }, [activeTab]);

  useEffect(() => {
    const checkAdmin = async () => {
      if (auth.currentUser) {
        try {
          const profile = await AdminUserService.getProfile(auth.currentUser.uid);
          const adminStatus = profile?.role === 'admin';
          setIsAdmin(adminStatus);
          if (adminStatus) {
            fetchData();
          }
        } catch {
          setIsAdmin(false);
        }
      }
    };
    checkAdmin();
  }, [activeTab, fetchData]);

  if (!isAdmin) {
    return <div className="text-center py-20 text-red-500">{t('admin_access_denied')}</div>;
  }

  const handleDeleteSession = (id: string) => {
    execute(
      () => AdminSessionService.deleteSession(id),
      { successMessage: t('save_success'), errorMessage: t('error_delete_failed'), onSuccess: () => setSessions(prev => prev.filter(s => s.id !== id)) }
    );
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8 pb-20"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold flex items-center gap-3 text-text-main">
          <Shield className="text-red-500" />
          {t('admin_title')}
        </h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 rounded-2xl w-fit bg-surface-base/10 border border-border-subtle">
        <button 
          onClick={() => setActiveTab('users')}
          className={cn(
            "flex items-center gap-2 px-6 py-2 rounded-2xl text-sm font-bold transition-all",
            activeTab === 'users' 
              ? "bg-surface-base/20 text-text-main shadow-sm" 
              : "text-text-main/50 hover:text-text-main"
          )}
        >
          <Users size={16} />
          {t('admin_tab_users')}
        </button>
        <button 
          onClick={() => setActiveTab('sessions')}
          className={cn(
            "flex items-center gap-2 px-6 py-2 rounded-2xl text-sm font-bold transition-all",
            activeTab === 'sessions' 
              ? "bg-surface-base/20 text-text-main shadow-sm" 
              : "text-text-main/50 hover:text-text-main"
          )}
        >
          <Database size={16} />
          {t('admin_tab_sessions')}
        </button>
        <button 
          onClick={() => setActiveTab('security')}
          className={cn(
            "flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all",
            activeTab === 'security' 
              ? "bg-surface-base/20 text-text-main shadow-sm" 
              : "text-text-main/50 hover:text-text-main"
          )}
        >
          <AlertTriangle size={16} />
          {t('admin_tab_security')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <LoadingSpinner size={10} />
        </div>
      ) : (
        <div className="rounded-3xl overflow-hidden transition-all bg-surface-card backdrop-blur-2xl border border-border-subtle shadow-sm">
          {activeTab === 'users' && (
            <AdminUsersTable users={users} />
          )}

          {activeTab === 'sessions' && (
            <>
              <AdminSessionsTable sessions={sessions} onDelete={setDeleteSessionId} />
              {hasMoreSessions && (
                <div className="p-6 flex justify-center border-t border-border-subtle">
                  <button
                    onClick={() => fetchData(false)}
                    disabled={loadingMoreSessions}
                    className="px-8 py-2 rounded-2xl font-bold transition-all disabled:opacity-50 bg-text-main text-surface-base shadow-lg"
                  >
                    {loadingMoreSessions ? t('archive_loading_more') : t('archive_load_more')}
                  </button>
                </div>
              )}
            </>
          )}

          {activeTab === 'security' && (
            <div className="p-8 space-y-6">
              <div className="p-6 rounded-2xl border bg-emerald-500/10 border-emerald-500/30">
                <h4 className="font-bold mb-2 flex items-center gap-2 text-emerald-400">
                  <Shield size={18} />
                  {t('admin_security_active')}
                </h4>
                <ul className="text-sm space-y-1 list-disc list-inside text-emerald-400/80">
                  <li>{t('admin_security_validation')}</li>
                  <li>{t('admin_security_size_limits')}</li>
                  <li>{t('admin_security_typing')}</li>
                  <li>{t('admin_security_uid_protection')}</li>
                  <li>{t('admin_security_email_validation')}</li>
                </ul>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-6 rounded-2xl border bg-surface-base/5 border-border-subtle">
                  <span className="text-xs font-bold uppercase tracking-widest text-text-main/50">{t('admin_security_xss_title')}</span>
                  <p className="text-sm mt-2 text-text-main/80">{t('admin_security_xss')}</p>
                </div>
                <div className="p-6 rounded-2xl border bg-surface-base/5 border-border-subtle">
                  <span className="text-xs font-bold uppercase tracking-widest text-text-main/50">{t('admin_security_csrf_title')}</span>
                  <p className="text-sm mt-2 text-text-main/80">{t('admin_security_csrf')}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      <CancelConfirmModal
        isOpen={!!deleteSessionId}
        title={t('admin_confirm_delete_session')}
        description={t('admin_confirm_delete_session_desc')}
        confirmLabel={t('session_delete')}
        cancelLabel={t('writing_cancel')}
        onConfirm={() => {
          if (deleteSessionId) handleDeleteSession(deleteSessionId);
          setDeleteSessionId(null);
        }}
        onCancel={() => setDeleteSessionId(null)}
      />
    </motion.div>
  );
}
