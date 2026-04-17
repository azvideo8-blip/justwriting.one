import { useState } from 'react';
import { cn, parseFirestoreDate } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { useLifeLog } from '../hooks/useLifeLog';
import { Session } from '../../../types';
import { formatTime } from '../../../core/utils/formatTime';
import { SettingsPanelContent } from '../../settings/components/SettingsPanel';
import { motion } from 'motion/react';
import { Pin } from 'lucide-react';

interface SessionItemProps {
  session: Session;
  isActive: boolean;
  onClick: () => void;
  t: (key: string) => string;
}

const SessionItem = ({ session, isActive, onClick, t }: SessionItemProps) => {
  const date = parseFirestoreDate(session.createdAt);
  const timeStr = date
    ? date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
    : '';

  const getStatusBadge = () => {
    if (!session.id) return { label: 'не сохранено', cls: 'bg-text-main/10 text-text-main' };
    if (session.isPublic) return { label: 'опубликовано', cls: 'bg-emerald-500/10 text-emerald-500' };
    return { label: 'сохранено', cls: 'bg-blue-500/10 text-blue-500' };
  };

  const badge = getStatusBadge();

  return (
    <div
      onClick={onClick}
      className={cn(
        "px-3 py-2.5 border-b border-border-subtle cursor-pointer transition-all",
        isActive
          ? "bg-surface-base border-l-2 border-l-text-main pl-[10px]"
          : "hover:bg-surface-base/50"
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-medium text-text-main truncate max-w-[130px]">
          {session.title || t('common_untitled')}
        </span>
        <span className="text-[11px] text-text-main/40 shrink-0">{timeStr}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-text-main/50">
          {session.wordCount} {t('lifelog_words_short')} · {formatTime(session.duration || 0)}
        </span>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", badge.cls)}>
          {badge.label}
        </span>
      </div>
    </div>
  );
};

interface LifeLogPanelProps {
  userId: string;
  onContinueSession: (session: Session) => void;
  onClose: () => void;
  activeTab?: 'log' | 'settings';
  onTabChange?: (tab: 'log' | 'settings') => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}

export function LifeLogPanel({ 
  userId, 
  onContinueSession, 
  onClose, 
  activeTab: externalTab,
  onTabChange,
  pinned,
  onTogglePin
}: LifeLogPanelProps) {
  const [internalTab, setInternalTab] = useState<'log' | 'settings'>('log');
  
  const activeTab = externalTab || internalTab;
  const setActiveTab = (tab: 'log' | 'settings') => {
    if (onTabChange) onTabChange(tab);
    else setInternalTab(tab);
  };

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { t } = useLanguage();
  const { sessionGroups, summary, loading } = useLifeLog(userId);

  return (
    <motion.div 
      initial={{ x: 380, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 380, opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="fixed top-0 right-0 bottom-0 w-[380px] z-50 flex flex-col border-l border-border-subtle bg-surface-card backdrop-blur-xl shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('log')}
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
            onClick={() => setActiveTab('settings')}
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
          {/* Pin Button */}
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

          {/* Close Button */}
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl text-text-main/40 hover:text-text-main hover:bg-text-main/5 transition-all flex items-center justify-center text-sm"
          >
            ✕
          </button>
        </div>
      </div>

      {activeTab === 'log' && (
        <div className="flex flex-col h-full overflow-hidden">
          {/* Daily summary */}
          <div className="shrink-0 px-3 py-3 border-b border-border-subtle bg-surface-base/50">
            <div className="text-[11px] text-text-main/40 mb-2">{t('lifelog_today')}</div>
            <div className="flex gap-4">
              <div>
                <div className="text-lg font-bold text-text-main">{summary.totalWords.toLocaleString()}</div>
                <div className="text-[11px] text-text-main/40">{t('lifelog_words')}</div>
              </div>
              <div>
                <div className="text-lg font-bold text-text-main">
                  {summary.totalMinutes >= 60
                    ? `${Math.floor(summary.totalMinutes / 60)}ч ${summary.totalMinutes % 60}м`
                    : `${summary.totalMinutes}м`}
                </div>
                <div className="text-[11px] text-text-main/40">{t('lifelog_time')}</div>
              </div>
            </div>
          </div>

          {/* Sessions list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-2 text-[11px] text-text-main/40 font-medium">{t('lifelog_loading')}</div>
            ) : (
              <div className="sessions-list flex-1 overflow-y-auto">
                {sessionGroups.map(group => (
                  <div key={group.date.toISOString()}>
                    <div className="px-4 py-2 text-[10px] text-text-main/30 font-bold uppercase tracking-wider sticky top-0 bg-surface-card z-10 border-b border-border-subtle/30">
                      {group.label}
                    </div>
                    {group.sessions.map(session => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        isActive={activeSessionId === session.id}
                        onClick={() => {
                          setActiveSessionId(session.id!);
                          onContinueSession(session);
                        }}
                        t={t}
                      />
                    ))}
                  </div>
                ))}
                {sessionGroups.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-text-main/30">
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
          <SettingsPanelContent userId={userId} />
        </div>
      )}
    </motion.div>
  );
}
