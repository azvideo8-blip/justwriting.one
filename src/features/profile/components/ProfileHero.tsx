import { useState, useMemo } from 'react';
import { User } from 'firebase/auth';
import { Pencil, PenLine, RefreshCw } from 'lucide-react';
import { UserProfile } from '../../../types';
import { ProfileService } from '../services/ProfileService';
import { useLanguage } from '../../../core/i18n';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';

const QUOTE_KEYS = [
  'profile_quote_1',  'profile_quote_2',  'profile_quote_3',
  'profile_quote_4',  'profile_quote_5',  'profile_quote_6',
  'profile_quote_7',  'profile_quote_8',  'profile_quote_9',
  'profile_quote_10', 'profile_quote_11', 'profile_quote_12',
  'profile_quote_13', 'profile_quote_14', 'profile_quote_15',
  'profile_quote_16', 'profile_quote_17', 'profile_quote_18',
  'profile_quote_19', 'profile_quote_20',
];

const todayQuoteKey = QUOTE_KEYS[new Date().getDate() % QUOTE_KEYS.length];

interface ProfileHeroProps {
  user: User | null;
  profile: UserProfile | null;
  isGuest: boolean;
  onStartSession: () => void;
  onSync?: () => void;
  syncing?: boolean;
}

export function ProfileHero({ user, profile, isGuest, onStartSession, onSync, syncing }: ProfileHeroProps) {
  const { t, language } = useLanguage();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(profile?.nickname || user?.displayName || '');
  const { execute } = useServiceAction();

  const handleSaveName = () => {
    setEditingName(false);
    if (user && name.trim()) {
      execute(() => ProfileService.updateNickname(user.uid, name), {
        successMessage: t('save_success'),
        errorMessage: t('error_nickname_failed'),
      });
    }
  };

  const initials = (name || 'А').slice(0, 1).toUpperCase();
  const memberSince = useMemo(() =>
    user?.metadata?.creationTime
      ? new Date(user.metadata.creationTime)
      : new Date()
  , [user]);
  const [now] = useState(() => Date.now());
  const daysSince = useMemo(
    () => Math.floor((now - memberSince.getTime()) / 86400000),
    [now, memberSince]
  );

  return (
    <div style={{
      padding: '32px 36px',
      background: 'radial-gradient(ellipse 60% 80% at 20% 30%, color-mix(in srgb, var(--flow-pulse-color) 12%, transparent), transparent 60%)',
      borderBottom: '1px solid var(--border-light)',
    }}>
      <div className="flex items-start gap-6">
        <div className="relative shrink-0">
          {user?.photoURL ? (
            <img src={user.photoURL} alt={name}
              className="w-24 h-24 rounded-full object-cover border border-white/10" />
          ) : (
            <div style={{
              width: 96, height: 96, borderRadius: '50%',
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--flow-pulse-color) 60%, #000), color-mix(in srgb, var(--flow-pulse-color) 20%, #000))',
              border: '1px solid var(--border-light)',
              boxShadow: '0 0 60px color-mix(in srgb, var(--flow-pulse-color) 15%, transparent)',
              display: 'grid', placeItems: 'center',
              fontSize: 42, fontFamily: 'Inter, sans-serif', fontWeight: 500, color: 'var(--text-main)',
            }}>
              {initials}
            </div>
          )}
        </div>

        <div className="flex-1 pt-1">
          <div className="flex items-center gap-2 mb-1">
            {editingName ? (
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                autoFocus
                className="text-3xl font-medium text-text-main bg-transparent border-b border-text-main/20 outline-none"
              />
            ) : (
              <h1 className="text-3xl font-medium text-text-main tracking-tight">
                {isGuest ? t('account_local_title') : name || t('me_anonymous')}
              </h1>
            )}
            {!isGuest && (
              <button onClick={() => setEditingName(true)}
                className="text-text-main/20 hover:text-text-main/50 transition-colors">
                <Pencil size={14} />
              </button>
            )}
          </div>

          {user?.email && (
            <div className="font-mono text-[13px] text-text-main/40 mb-4">
              {user.email}
            </div>
          )}

          <div className="font-serif italic text-[14px] text-text-main/50 leading-relaxed max-w-lg mb-5">
             «{t(todayQuoteKey)}»
          </div>

          <div className="flex gap-2">
            <button
              onClick={onStartSession}
              style={{ background: 'var(--flow-pulse-color)' }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-surface-base"
            >
              <PenLine size={14} />
              {t('home_cta')}
            </button>
            {onSync && (
              <button onClick={onSync} disabled={syncing}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] border border-border-subtle text-text-main/50 hover:text-text-main transition-all disabled:opacity-40"
              >
                <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                {syncing ? t('profile_syncing') : t('profile_sync_button')}
              </button>
            )}
          </div>
        </div>

        <div className="text-right shrink-0 border border-border-subtle rounded-xl p-3 bg-surface-card">
          <div className="font-mono text-[10px] text-text-main/30 uppercase tracking-widest mb-1">
            {t('profile_member_since')}
          </div>
          <div className="text-[18px] font-medium text-text-main">
            {memberSince.toLocaleDateString(language, { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <div className="font-mono text-[11px] text-text-main/40 mt-1">
            {daysSince} {t('home_streak_days')}
          </div>
        </div>
      </div>
    </div>
  );
}
