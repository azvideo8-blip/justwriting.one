import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { Pencil, PenLine } from 'lucide-react';
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

interface ProfileHeroProps {
  user: User | null;
  profile: UserProfile | null;
  isGuest: boolean;
  onStartSession: () => void;
}

export function ProfileHero({ user, profile, isGuest, onStartSession }: ProfileHeroProps) {
  const { t, language } = useLanguage();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(profile?.nickname || user?.displayName || '');
  const { execute } = useServiceAction();
  const [quoteIdx, setQuoteIdx] = useState(() => new Date().getDate() % QUOTE_KEYS.length);
  const nextQuote = useCallback(() => setQuoteIdx(i => (i + 1) % QUOTE_KEYS.length), []);
  useEffect(() => { const id = setInterval(nextQuote, 12000); return () => clearInterval(id); }, [nextQuote]);

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
    <div
      className="px-6 py-6 md:px-9 md:py-8"
      style={{
        background: 'radial-gradient(ellipse 60% 80% at 20% 30%, color-mix(in srgb, var(--flow-pulse-color) 12%, transparent), transparent 60%)',
        borderBottom: '1px solid var(--border-light)',
      }}
    >
      <div className="flex flex-col md:flex-row items-center md:items-start gap-6 text-center md:text-left">
        <div className="relative shrink-0">
          <motion.div
            animate={{ boxShadow: ['0 0 0px color-mix(in srgb, var(--flow-pulse-color) 0%, transparent)', '0 0 40px color-mix(in srgb, var(--flow-pulse-color) 25%, transparent)', '0 0 0px color-mix(in srgb, var(--flow-pulse-color) 0%, transparent)'] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
            style={{ borderRadius: '50%' }}
          >
            {user?.photoURL ? (
              <img src={user.photoURL} alt={name}
                className="w-16 h-16 md:w-24 md:h-24 rounded-full object-cover border border-white/10" />
            ) : (
              <div style={{
                borderRadius: '50%',
                background: 'linear-gradient(135deg, color-mix(in srgb, var(--flow-pulse-color) 60%, #000), color-mix(in srgb, var(--flow-pulse-color) 20%, #000))',
                border: '1px solid var(--border-light)',
                boxShadow: '0 0 60px color-mix(in srgb, var(--flow-pulse-color) 15%, transparent)',
                display: 'grid', placeItems: 'center',
                fontFamily: 'Inter, sans-serif', fontWeight: 500, color: 'var(--text-main)',
              }}
              className="w-16 h-16 md:w-24 md:h-24 text-2xl md:text-4xl"
              >
                {initials}
              </div>
            )}
          </motion.div>
        </div>

        <div className="flex-1 pt-1 w-full flex flex-col items-center md:items-start">
          <div className="flex items-center justify-center md:justify-start gap-2 mb-1 w-full">
            {editingName ? (
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                autoFocus
                className="text-2xl md:text-3xl font-medium text-text-main bg-transparent border-b border-text-main/20 outline-none text-center md:text-left"
              />
            ) : (
              <h1 className="text-2xl md:text-3xl font-medium text-text-main tracking-tight">
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
            <div className="font-mono text-[12px] md:text-[13px] text-text-main/40 mb-3 md:mb-4">
              {user.email}
            </div>
          )}

          <div className="font-serif italic text-[13px] md:text-[14px] text-text-main/50 leading-relaxed max-w-lg mb-4 md:mb-5 min-h-[20px] text-center md:text-left">
            <AnimatePresence mode="wait">
              <motion.span
                key={quoteIdx}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.35 }}
              >
                «{t(QUOTE_KEYS[quoteIdx])}»
              </motion.span>
            </AnimatePresence>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto items-stretch sm:items-center">
            <button
              onClick={onStartSession}
              style={{ background: 'var(--flow-pulse-color)' }}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-surface-base w-full sm:w-auto"
            >
              <PenLine size={14} />
              {t('home_cta')}
            </button>
          </div>
        </div>

        <div className="text-center md:text-right w-full md:w-auto border border-border-subtle rounded-xl p-3 bg-surface-card/45">
          <div className="font-mono text-[10px] text-text-main/30 uppercase tracking-widest mb-1">
            {t('profile_member_since')}
          </div>
          <div className="text-[16px] md:text-[18px] font-medium text-text-main">
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
