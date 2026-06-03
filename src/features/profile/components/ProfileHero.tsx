import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { Pencil, PenLine } from 'lucide-react';
import { UserProfile } from '../../../types';
import { ProfileService } from '../services/ProfileService';
import { useLanguage } from '../../../shared/i18n';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { IconButton } from '../../../shared/components/IconButton';
import { Button } from '../../../shared/components/Button';

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
      void execute(() => ProfileService.updateNickname(user.uid, name), {
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
      className="px-6 py-6 md:px-9 md:py-8 bg-[radial-gradient(ellipse_60%_80%_at_20%_30%,color-mix(in_srgb,var(--flow-pulse-color)_12%,transparent),transparent_60%)] border-b border-[var(--border-light)]"
    >
      <div className="flex flex-col md:flex-row items-center md:items-start gap-6 text-center md:text-left">
        <div className="relative shrink-0">
          <motion.div
            animate={{ boxShadow: ['0 0 0px color-mix(in srgb, var(--flow-pulse-color) 0%, transparent)', '0 0 40px color-mix(in srgb, var(--flow-pulse-color) 25%, transparent)', '0 0 0px color-mix(in srgb, var(--flow-pulse-color) 0%, transparent)'] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
            className="rounded-full" 
          >
            {user?.photoURL ? (
              <img src={user.photoURL} alt={name}
                className="w-16 h-16 md:w-24 md:h-24 rounded-full object-cover border border-white/10" />
            ) : (
              <div className="w-16 h-16 md:w-24 md:h-24 text-2xl md:text-4xl rounded-full bg-gradient-to-br from-[color-mix(in_srgb,var(--flow-pulse-color)_60%,#000)] to-[color-mix(in_srgb,var(--flow-pulse-color)_20%,#000)] border border-[var(--border-light)] shadow-[0_0_60px_color-mix(in_srgb,var(--flow-pulse-color)_15%,transparent)] grid place-items-center font-sans font-medium text-[var(--text-main)]"
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
              <IconButton onClick={() => setEditingName(true)}
                className="text-text-main/20 hover:text-text-main/50 transition-colors"
                label="Edit name"
                icon={<Pencil size={14} />}
              />
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
                «{t(QUOTE_KEYS[quoteIdx]!)}»
              </motion.span>
            </AnimatePresence>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto items-stretch sm:items-center">
            <Button
              onClick={onStartSession}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-text-main/60 hover:text-text-main border border-border-subtle hover:border-text-main/30 transition-colors w-full sm:w-auto"
            >
              <PenLine size={13} />
              {t('profile_cta')}
            </Button>
          </div>
        </div>

        <div className="text-center md:text-right w-full md:w-auto border border-border-subtle rounded-xl p-3 bg-surface-card/45">
          <div className="font-mono text-label text-text-main/30 uppercase tracking-widest mb-1">
            {t('profile_member_since')}
          </div>
          <div className="text-[16px] md:text-[18px] font-medium text-text-main">
            {memberSince.toLocaleDateString(language, { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <div className="font-mono text-label-sm text-text-main/40 mt-1">
            {daysSince} {t('home_streak_days')}
          </div>
        </div>
      </div>
    </div>
  );
}
