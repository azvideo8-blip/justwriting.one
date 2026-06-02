import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, AlertCircle, Loader2 } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { WrongPasswordError, unlockVault } from '../../../core/services/EncryptionService';
import { reportError } from '../../../shared/errors/reportError';

interface UnlockPromptProps {
  uid: string;
  onUnlocked: () => void;
  onClose: () => void;
}

export function UnlockPrompt({ uid, onUnlocked, onClose }: UnlockPromptProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError(null);

    try {
      await unlockVault(uid, password);
      showToast(t('unlock_success'), 'success');
      onUnlocked();
    } catch (e) {
      if (e instanceof WrongPasswordError) {
        setError(t('unlock_wrong_password'));
      } else {
        reportError(e, { action: 'unlockEncryption', uid });
        setError(t('error_generic'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[var(--z-critical)] flex items-center justify-center bg-surface-base/80 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-[360px] bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg"
          onClick={e => e.stopPropagation()}
        >
          <div className="w-10 h-10 rounded-2xl bg-brand-soft/10 border border-brand-soft/30 flex items-center justify-center mb-4">
            <Lock size={18} className="text-brand-soft" />
          </div>
          <h2 className="text-base font-medium text-text-main mb-1">
            {t('unlock_title')}
          </h2>
          <p className="text-sm text-text-main/50 mb-4">
            {t('unlock_subtitle')}
          </p>

          {error && (
            <div className="p-3 rounded-lg bg-accent-danger/10 border border-accent-danger/20 text-accent-danger text-xs mb-3 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); void handleUnlock(e); }} className="space-y-3">
            <input
              type="password"
              autoFocus
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl outline-none bg-surface-base/5 border border-border-subtle text-text-main text-sm focus:ring-2 focus:ring-brand-soft/40 placeholder:text-text-main/20"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading || !password}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-colors flex items-center justify-center gap-2 bg-[var(--brand-primary)]"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={14} />}
                {t('unlock_submit')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-sm text-text-main/40 hover:text-text-main/60 transition-colors"
              >
                {t('common_cancel')}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
