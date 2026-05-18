import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'motion/react';
import { cn, parseFirestoreDate } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { useLifeLog } from '../hooks/useLifeLog';
import { LifeLogDocument } from '../types/lifeLog';
import { Session } from '../../../types';
import { SettingsPanelContent } from '../../settings/components/SettingsPanel';
import { CancelConfirmModal } from '../../../shared/components/CancelConfirmModal';
import { deleteSession } from '../services/SessionDeleteService';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { X, Pin, Trash2, Cloud, HardDrive, ArrowRight } from 'lucide-react';
import { highlightText } from '../../../shared/utils/highlightText';

interface SessionItemProps {
  session: Session;
  doc?: LifeLogDocument;
  isActive: boolean;
  onClick: () => void;
  onDelete?: (session: Session) => void;
  t: (key: string) => string;
  language: string;
  userId: string;
  onStorageChange: () => void;
  maxWords: number;
  searchQuery?: string;
}

const SessionItem = React.memo(({ session, doc, isActive, onClick, onDelete, t, language, userId: _userId, onStorageChange: _onStorageChange, maxWords, searchQuery }: SessionItemProps) => {
  const date = parseFirestoreDate(session.createdAt);
  const timeStr = date
    ? date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
    : '';

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);
  const isRecent = date ? (now - date.getTime()) < 30 * 60 * 1000 : false;

  const getStatusBadge = () => {
    if (!session.id) return { label: t('lifelog_status_unsaved'), cls: 'bg-text-main/10 text-text-main' };
    return { label: t('lifelog_status_saved'), cls: 'bg-accent-info/10 text-accent-info' };
  };

  const badge = getStatusBadge();

  return (
    <div
      onClick={onClick}
      className={cn(
        "group px-3 py-2.5 border-b border-border-subtle cursor-pointer transition-all",
        isActive
          ? "bg-surface-base border-l-2 border-l-text-main pl-[10px]"
          : "hover:bg-surface-base/50"
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-medium text-text-main truncate max-w-[130px]">
          {highlightText(session.title || t('common_untitled'), searchQuery || '')}
        </span>
        <div className="flex items-center gap-1">
          {isRecent ? (
            <span className="flex items-center gap-1 text-[11px] text-accent-success shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-success animate-pulse shrink-0" />
              {t('lifelog_just_now')}
            </span>
          ) : (
            <span className="text-[11px] text-text-subtle shrink-0">{timeStr}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-text-main/30 hover:text-text-main transition-all"
            aria-label={t('lifelog_continue')}
          >
            <ArrowRight size={12} />
          </button>
          {onDelete && session.id && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(session); }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-text-main/30 hover:text-accent-danger transition-all"
              aria-label={t('session_delete')}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">
            {session.wordCount} {t('lifelog_words_short')} · {(() => {
              const mins = Math.round((session.duration || 0) / 60);
              return mins < 1 ? `<1${t('goal_time_min')}` : `${mins}${t('goal_time_min')}`;
            })()}
          </span>
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", badge.cls)}>
            {badge.label}
          </span>
          {doc?.storage?.cloud
            ? <Cloud size={10} className="text-blue-400/60" />
            : <HardDrive size={10} className="text-text-main/30" />
          }
        </div>
        {session.content && (
          <p className="text-[12px] text-text-main/30 truncate mt-0.5 leading-none">
            {highlightText(session.content.slice(0, 80).replace(/\n/g, ' '), searchQuery || '')}
          </p>
        )}
        <div className="mt-1.5 h-[2px] rounded-full bg-border-subtle overflow-hidden">
          <div
            className="h-full rounded-full bg-brand-soft/50"
            style={{ width: `${Math.min(100, Math.round((session.wordCount || 0) / maxWords * 100))}%` }}
          />
        </div>
    </div>
  );
});

interface LifeLogPanelProps {
  userId: string;
  onContinueSession: (session: Session | LifeLogDocument) => void;
  onClose: () => void;
  activeTab: 'log' | 'settings';
  onTabChange: (tab: 'log' | 'settings') => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  inGrid?: boolean;
  onRefreshDocuments?: () => void;
  streakDays?: number;
}

export function LifeLogPanel({
  userId, 
  onContinueSession, 
  onClose, 
  activeTab,
  onTabChange,
  pinned,
  onTogglePin,
  inGrid,
  onRefreshDocuments,
  streakDays,
}: LifeLogPanelProps) {
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { t, language } = useLanguage();
  const { execute } = useServiceAction();
  const { isGuest } = useAuthStatus();
  const { sessionGroups, summary, loading, refresh, unifiedDocuments } = useLifeLog(userId, isGuest);

  const docMap = useMemo(() => {
    const map = new Map<string, LifeLogDocument>();
    for (const doc of unifiedDocuments) {
      const key = doc.localId || doc.cloudId || '';
      if (key) map.set(key, doc);
    }
    return map;
  }, [unifiedDocuments]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return sessionGroups;
    const q = searchQuery.toLowerCase();
    return sessionGroups
      .map(group => ({
        ...group,
        sessions: group.sessions.filter(s =>
          (s.title || '').toLowerCase().includes(q) ||
          (s.content || '').toLowerCase().includes(q)
        )
      }))
      .filter(group => group.sessions.length > 0);
  }, [sessionGroups, searchQuery]);

  return (
    <motion.div 
      initial={{ x: 380, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 380, opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn(
        "flex flex-col h-full border-l border-border-subtle bg-surface-card backdrop-blur-xl",
        inGrid ? "w-full" : "fixed top-0 right-0 bottom-0 w-[380px] z-50 shadow-2xl"
      )}
      style={{ boxShadow: '-12px 0 40px rgba(0,0,0,0.35)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex gap-1">
          <button
            onClick={() => onTabChange('log')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-sm transition-all",
              activeTab === 'log'
                ? "bg-text-main text-surface-base"
                : "text-text-main/50 hover:text-text-main"
            )}
          >
            {t('lifelog_tab_log')}
          </button>
          <button
            onClick={() => onTabChange('settings')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-sm transition-all",
              activeTab === 'settings'
                ? "bg-text-main text-surface-base"
                : "text-text-main/50 hover:text-text-main"
            )}
          >
            {t('lifelog_tab_settings')}
          </button>
        </div>
        
        <div className="flex items-center gap-1">
          <button
            onClick={onTogglePin}
            title={pinned ? t('lifelog_unpin') : t('lifelog_pin')}
            className={cn(
              "w-8 h-8 rounded-xl border transition-all flex items-center justify-center",
              pinned
                ? "border-text-main/30 bg-text-main/10 text-text-main"
                : "border-border-subtle text-text-main/40 hover:text-text-main"
            )}
          >
            <Pin size={14} />
          </button>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl text-text-main/40 hover:text-text-main hover:bg-text-main/5 transition-all flex items-center justify-center"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {activeTab === 'log' && (
        <div className="flex flex-col h-full overflow-hidden">
          {/* Search */}
          <div className="px-3 py-2 border-b border-border-subtle">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('lifelog_search_placeholder')}
              className="w-full bg-surface-base rounded-xl px-3 py-2 text-sm text-text-main placeholder:text-text-main/30 outline-none border border-border-subtle focus:border-text-main/30"
            />
          </div>

          {/* Daily summary */}
          <div className="shrink-0 px-3 py-3 border-b border-border-subtle bg-surface-base/50">
            <div className="text-[11px] text-text-subtle mb-2">{t('lifelog_today')}</div>
            <div className="flex gap-4">
              <div>
                <div className="text-lg font-bold text-text-main">{summary.totalWords.toLocaleString()}</div>
                <div className="text-[11px] text-text-subtle">{t('lifelog_words')}</div>
              </div>
              <div>
                <div className="text-lg font-bold text-text-main">
                  {summary.totalMinutes >= 60
                    ? `${Math.floor(summary.totalMinutes / 60)}${t('unit_hour')} ${summary.totalMinutes % 60}${t('unit_min')}`
                    : `${summary.totalMinutes}${t('unit_min')}`}
                </div>
                <div className="text-[11px] text-text-subtle">{t('lifelog_time')}</div>
              </div>
              {streakDays !== undefined && (
                <div>
                  <div className="text-lg font-bold" style={{ color: 'var(--flow-pulse-color)' }}>
                    {streakDays}
                  </div>
                  <div className="text-[11px] text-text-subtle">{t('home_streak_days')}</div>
                </div>
              )}
            </div>
          </div>

          {/* Sessions list grouped by date */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-2 text-[11px] text-text-subtle font-medium">{t('lifelog_loading')}</div>
            ) : (
              <div className="sessions-list flex-1 overflow-y-auto">
                {filteredGroups.map(group => {
                  const groupWords = group.sessions.reduce((s, sess) => s + (sess.wordCount || 0), 0);
                  const maxWords = Math.max(...group.sessions.map(s => s.wordCount || 0), 1);
                  return (
                    <div key={group.date.toISOString()}>
                      <div className="px-4 py-2 text-[10px] text-text-subtle font-bold uppercase tracking-wider sticky top-0 bg-surface-card z-10 border-b border-border-subtle/30 flex items-center justify-between">
                        <span>{group.label}</span>
                        <span className="font-mono font-normal normal-case tracking-normal text-text-main/25">
                          {groupWords.toLocaleString()} {t('lifelog_words_short')}
                        </span>
                      </div>
                      {group.sessions.map(session => (
                        <SessionItem
                          key={session.id}
                          session={session}
                          doc={docMap.get(session.id)}
                          isActive={false}
                          onClick={() => onContinueSession(docMap.get(session.id) || session)}
                          onDelete={(s) => setDeleteTarget(s)}
                          t={t}
                          language={language}
                          userId={userId}
                          onStorageChange={() => { refresh(); onRefreshDocuments?.(); }}
                          maxWords={maxWords}
                          searchQuery={searchQuery}
                        />
                      ))}
                    </div>
                  );
                })}
                {filteredGroups.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-text-subtle">
                    {t('lifelog_empty')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="flex-1 overflow-hidden w-[380px]">
          <SettingsPanelContent userId={userId} onRefreshLifeLog={refresh} />
        </div>
      )}

      {/* Delete confirm */}
      <CancelConfirmModal
        isOpen={!!deleteTarget}
        title={t('session_delete_confirm')}
        description={t('admin_confirm_delete_session')}
        confirmLabel={t('session_delete')}
        cancelLabel={t('common_cancel')}
        onConfirm={async () => {
          if (deleteTarget?.id) {
            await execute(
              () => deleteSession(userId, deleteTarget),
              { successMessage: t('session_deleted'), errorMessage: t('error_delete_failed') }
            );
            refresh();
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </motion.div>
  );
}
