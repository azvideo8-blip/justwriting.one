import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { UserService } from '../services/UserService';
import { SessionService } from '../services/SessionService';
import { auth } from '../core/firebase';
import { User as UserIcon, PenLine, TrendingUp, Check, X, Users, Database, Shield, AlertTriangle } from 'lucide-react';
import { AdminUsersTable } from '../components/admin/AdminUsersTable';
import { AdminSessionsTable } from '../components/admin/AdminSessionsTable';
import { useLanguage } from '../core/i18n';
import { useUI } from '../contexts/UIContext';
import { cn } from '../core/utils/utils';

export function AdminView() {
  const [users, setUsers] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'sessions' | 'security'>('users');
  const [isAdmin, setIsAdmin] = useState(false);
  const { t } = useLanguage();
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'users') {
        const usersData = await UserService.getUsers(50);
        setUsers(usersData);
      } else if (activeTab === 'sessions') {
        const sessionsData = await SessionService.getAllSessionsAdmin(50);
        setSessions(sessionsData);
      }
    } catch (err) {
      console.error("Admin fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const checkAdmin = async () => {
      if (auth.currentUser) {
        const profile = await UserService.getProfile(auth.currentUser.uid);
        const adminStatus = profile?.role === 'admin';
        setIsAdmin(adminStatus);
        if (adminStatus) {
          fetchData();
        }
      }
    };
    checkAdmin();
  }, [activeTab]);

  if (!isAdmin) {
    return <div className="text-center py-20 text-red-500">Access Denied</div>;
  }

  const handleDeleteSession = async (id: string) => {
    if (!confirm(t('admin_confirm_delete_session'))) return;
    await SessionService.deleteSession(id);
    setSessions(sessions.filter(s => s.id !== id));
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8 pb-20"
    >
      <div className="flex items-center justify-between">
        <h2 className={cn("text-3xl font-bold flex items-center gap-3", isV2 ? "text-white" : "dark:text-stone-100")}>
          <Shield className={isV2 ? "text-red-400" : "text-red-500"} />
          {t('admin_title')}
        </h2>
      </div>

      {/* Tabs */}
      <div className={cn("flex gap-2 p-1 rounded-2xl w-fit", isV2 ? "bg-white/5 border border-white/10" : "bg-stone-100 dark:bg-stone-900")}>
        <button 
          onClick={() => setActiveTab('users')}
          className={cn(
            "flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all",
            activeTab === 'users' 
              ? (isV2 ? "bg-white/20 text-white shadow-sm" : "bg-white dark:bg-stone-800 shadow-sm text-stone-900 dark:text-stone-100") 
              : (isV2 ? "text-white/50 hover:text-white" : "text-stone-500 hover:text-stone-700")
          )}
        >
          <Users size={16} />
          {t('admin_tab_users')}
        </button>
        <button 
          onClick={() => setActiveTab('sessions')}
          className={cn(
            "flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all",
            activeTab === 'sessions' 
              ? (isV2 ? "bg-white/20 text-white shadow-sm" : "bg-white dark:bg-stone-800 shadow-sm text-stone-900 dark:text-stone-100") 
              : (isV2 ? "text-white/50 hover:text-white" : "text-stone-500 hover:text-stone-700")
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
              ? (isV2 ? "bg-white/20 text-white shadow-sm" : "bg-white dark:bg-stone-800 shadow-sm text-stone-900 dark:text-stone-100") 
              : (isV2 ? "text-white/50 hover:text-white" : "text-stone-500 hover:text-stone-700")
          )}
        >
          <AlertTriangle size={16} />
          {t('admin_tab_security')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className={cn("w-10 h-10 border-4 rounded-full animate-spin", isV2 ? "border-white/10 border-t-white" : "border-stone-200 border-t-stone-900 dark:border-stone-800 dark:border-t-stone-100")} />
        </div>
      ) : (
        <div className={cn(
          "rounded-3xl overflow-hidden transition-all",
          isV2 
            ? "bg-[#0A0A0B]/80 backdrop-blur-2xl border border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.8)]" 
            : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-sm"
        )}>
          {activeTab === 'users' && (
            <AdminUsersTable users={users} />
          )}

          {activeTab === 'sessions' && (
            <AdminSessionsTable sessions={sessions} onDelete={handleDeleteSession} />
          )}

          {activeTab === 'security' && (
            <div className="p-8 space-y-6">
              <div className={cn("p-6 rounded-2xl border", isV2 ? "bg-emerald-500/10 border-emerald-500/30" : "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-900/30")}>
                <h4 className={cn("font-bold mb-2 flex items-center gap-2", isV2 ? "text-emerald-400" : "text-emerald-800 dark:text-emerald-400")}>
                  <Shield size={18} />
                  {t('admin_security_active')}
                </h4>
                <ul className={cn("text-sm space-y-1 list-disc list-inside", isV2 ? "text-emerald-400/80" : "text-emerald-700 dark:text-emerald-500")}>
                  <li>{t('admin_security_validation')}</li>
                  <li>{t('admin_security_size_limits')}</li>
                  <li>{t('admin_security_typing')}</li>
                  <li>{t('admin_security_uid_protection')}</li>
                  <li>{t('admin_security_email_validation')}</li>
                </ul>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={cn("p-6 rounded-2xl border", isV2 ? "bg-white/5 border-white/10" : "bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800")}>
                  <span className={cn("text-xs font-bold uppercase tracking-widest", isV2 ? "text-white/50" : "text-stone-400")}>XSS Protection</span>
                  <p className={cn("text-sm mt-2", isV2 ? "text-white/80" : "")}>{t('admin_security_xss')}</p>
                </div>
                <div className={cn("p-6 rounded-2xl border", isV2 ? "bg-white/5 border-white/10" : "bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800")}>
                  <span className={cn("text-xs font-bold uppercase tracking-widest", isV2 ? "text-white/50" : "text-stone-400")}>CSRF Protection</span>
                  <p className={cn("text-sm mt-2", isV2 ? "text-white/80" : "")}>{t('admin_security_csrf')}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
