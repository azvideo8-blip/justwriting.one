import React, { useState, useMemo, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn, parseFirestoreDate } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { useLifeLog, LifeLogDocument } from '../hooks/useLifeLog';
import { Session } from '../../../types';
import { LocalVersionService } from '../services/LocalVersionService';
import { SettingsPanelContent } from '../../settings/components/SettingsPanel';
import { CancelConfirmModal } from './modals/CancelConfirmModal';
import { SessionService } from '../services/SessionService';
import { StorageService } from '../services/StorageService';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { useServiceAction } from '../hooks/useServiceAction';
import { useToast } from '../../../shared/components/Toast';
import { X, Pin, Trash2, Cloud, HardDrive } from 'lucide-react';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';

function docToSession(doc: LifeLogDocument): Session & { _isLocal?: boolean } {
  return {
    id: doc.localId || doc.cloudId || '',
    userId: '',
    authorName: '',
    authorPhoto: '',
    content: '',
    duration: doc.totalDuration,
    wordCount: doc.totalWords,
    charCount: 0,
    wpm: 0,
    isPublic: false,
    title: doc.title,
    tags: doc.tags,
    createdAt: new Date(doc.lastSessionAt),
    _isLocal: !!doc.localId,
  } as Session & { _isLocal?: boolean };
}

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
}

const SessionItem: React.FC<SessionItemProps> = ({ session, doc, isActive, onClick, onDelete, t, language, userId, onStorageChange }) => {
  const date = parseFirestoreDate(session.createdAt);
  const timeStr = date
    ? date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
    : '';

  const getStatusBadge = () => {
    if (!session.id) return { label: t('lifelog_status_unsaved'), cls: 'bg-text-main/10 text-text-main' };
    if (session.isPublic) return { label: t('lifelog_status_published'), cls: 'bg-accent-success/10 text-accent-success' };
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
          {session.title || t('common_untitled')}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-text-subtle shrink-0">{timeStr}</span>
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
          {doc ? (
            <StorageIcons doc={doc} userId={userId} onStorageChange={onStorageChange} />
          ) : session._isLocal ? (
            <span title={t('storage_local')}><HardDrive size={10} className="text-text-main/30" /></span>
          ) : (
            <span title={t('storage_cloud')}><Cloud size={10} className="text-text-main/30" /></span>
          )}
        </div>
    </div>
  );
};

function StorageIcons({
  doc,
  userId,
  onStorageChange,
}: {
  doc: LifeLogDocument;
  userId: string;
  onStorageChange: () => void;
}) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [confirmState, setConfirmState] = useState<{
    type: 'local' | 'cloud' | null;
    isOnly: boolean;
  }>({ type: null, isOnly: false });

  const handleLocalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!doc.storage.local) return;
    const isOnly = doc.storage.local && !doc.storage.cloud;
    setConfirmState({ type: 'local', isOnly });
  };

  const handleCloudClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!doc.storage.cloud) return;
    const isOnly = doc.storage.cloud && !doc.storage.local;
    setConfirmState({ type: 'cloud', isOnly });
  };

  const handleConfirmDelete = async () => {
    try {
      if (confirmState.type === 'local' && confirmState.isOnly) {
        await StorageService.deleteDocument(userId, doc.localId, doc.cloudId);
        showToast(t('storage_deleted_completely'), 'success');
      } else if (confirmState.type === 'local') {
        await StorageService.removeLocalCopy(doc.localId!);
        showToast(t('storage_deleted_local'), 'success');
      } else if (confirmState.type === 'cloud' && confirmState.isOnly) {
        await StorageService.deleteDocument(userId, doc.localId, doc.cloudId);
        showToast(t('storage_deleted_completely'), 'success');
      } else if (confirmState.type === 'cloud') {
        await StorageService.removeCloudCopy(userId, doc.cloudId!);
        if (doc.localId) {
          await LocalDocumentService.updateLinkedCloudId(doc.localId, '');
        }
        showToast(t('storage_deleted_cloud'), 'success');
      }
      onStorageChange();
    } catch {
      showToast(t('error_generic_action'), 'error');
    } finally {
      setConfirmState({ type: null, isOnly: false });
    }
  };

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        onClick={handleLocalClick}
        title={doc.storage.local ? t('storage_remove_local') : t('storage_no_local')}
        className={cn(
          "w-6 h-6 rounded-lg flex items-center justify-center transition-all",
          doc.storage.local
            ? "text-text-main/70 hover:text-red-400 hover:bg-red-400/10"
            : "text-text-main/20 cursor-default"
        )}
      >
        <HardDrive size={14} />
      </button>

      <button
        onClick={handleCloudClick}
        title={doc.storage.cloud ? t('storage_remove_cloud') : t('storage_no_cloud')}
        className={cn(
          "w-6 h-6 rounded-lg flex items-center justify-center transition-all",
          doc.storage.cloud
            ? "text-blue-400 hover:text-red-400 hover:bg-red-400/10"
            : "text-text-main/20 cursor-default"
        )}
      >
        <Cloud size={14} />
      </button>

      <AnimatePresence>
        {confirmState.type && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-[300] flex items-center justify-center bg-surface-base/60 backdrop-blur-sm"
            onClick={() => setConfirmState({ type: null, isOnly: false })}
          >
            <motion.div
              className="bg-surface-card border border-border-subtle rounded-2xl p-5 w-[320px] shadow-lg"
              onClick={e => e.stopPropagation()}
            >
              <div className="text-sm font-medium text-text-main mb-2">
                {confirmState.isOnly
                  ? t('storage_confirm_delete_only')
                  : confirmState.type === 'local'
                    ? t('storage_confirm_delete_local')
                    : t('storage_confirm_delete_cloud')}
              </div>
              <div className="text-xs text-text-main/40 mb-4">
                {confirmState.isOnly
                  ? t('storage_confirm_delete_only_hint')
                  : confirmState.type === 'local'
                    ? t('storage_confirm_delete_local_hint')
                    : t('storage_confirm_delete_cloud_hint')}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleConfirmDelete}
                  className="flex-1 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/20 transition-all"
                >
                  {t('storage_delete_confirm')}
                </button>
                <button
                  onClick={() => setConfirmState({ type: null, isOnly: false })}
                  className="flex-1 py-2 rounded-xl border border-border-subtle text-text-main/50 text-sm hover:text-text-main transition-all"
                >
                  {t('common_cancel')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
}: LifeLogPanelProps) {
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { t, language } = useLanguage();
  const { execute } = useServiceAction();
  const { sessionGroups, summary, loading, refresh, unifiedDocuments } = useLifeLog(userId);

  const docMap = useMemo(() => {
    const map = new Map<string, LifeLogDocument>();
    for (const doc of unifiedDocuments) {
      const key = doc.localId || doc.cloudId || '';
      if (key) map.set(key, doc);
    }
    return map;
  }, [unifiedDocuments]);

  const handleStorageChange = useCallback(() => {
    refresh();
    onRefreshDocuments?.();
  }, [refresh, onRefreshDocuments]);

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
            </div>
          </div>

          {/* Sessions list grouped by date */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-2 text-[11px] text-text-subtle font-medium">{t('lifelog_loading')}</div>
            ) : (
              <div className="sessions-list flex-1 overflow-y-auto">
                {filteredGroups.map(group => (
                  <div key={group.date.toISOString()}>
                    <div className="px-4 py-2 text-[10px] text-text-subtle font-bold uppercase tracking-wider sticky top-0 bg-surface-card z-10 border-b border-border-subtle/30">
                      {group.label}
                    </div>
                    {group.sessions.map(session => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        doc={docMap.get(session.id)}
                        isActive={false}
                        onClick={() => onContinueSession(session)}
                        onDelete={(s) => setDeleteTarget(s)}
                        t={t}
                        language={language}
                        userId={userId}
                        onStorageChange={handleStorageChange}
                      />
                    ))}
                  </div>
                ))}
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
              async () => {
                if (deleteTarget._isLocal) {
                  const doc = await LocalDocumentService.getDocument(deleteTarget.id);
                  await StorageService.deleteDocument('', deleteTarget.id, doc?.linkedCloudId || undefined);
                } else {
                  await SessionService.deleteSession(deleteTarget.id);
                }
              },
              { successMessage: t('save_success'), errorMessage: t('error_delete_failed') }
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
