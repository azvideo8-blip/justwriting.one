import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, AlertCircle, Loader2 } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { useToast } from '../../../shared/components/Toast';
import { deriveMasterKey, unwrapDataKey, setSessionKey, fromBase64 } from '../../../core/crypto/encrypt';
import { getClient } from '../../../core/firebase/firestoreClient';
import { reportError } from '../../../core/errors/reportError';

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
      const { db, mod } = await getClient();
      const { doc, getDoc } = mod;
      const snap = await getDoc(doc(db, 'users', uid));
      if (!snap.exists()) {
        setError(t('error_generic'));
        setLoading(false);
        return;
      }
      const data = snap.data();
      if (!data.encryptionSalt || !data.encryptedDataKey) {
        setError(t('unlock_no_keys_error'));
        setLoading(false);
        return;
      }
      const salt = fromBase64(data.encryptionSalt as string);
      const masterKey = await deriveMasterKey(password, salt);
      const dataKey = await unwrapDataKey(data.encryptedDataKey as string, masterKey);
      setSessionKey(dataKey);
      showToast(t('unlock_success'), 'success');
      onUnlocked();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'OperationError') {
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
        className="fixed inset-0 z-[300] flex items-center justify-center bg-surface-base/80 backdrop-blur-sm"
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
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs mb-3 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleUnlock} className="space-y-3">
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
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:brightness-110 transition-all flex items-center justify-center gap-2"
                style={{ background: 'var(--brand-primary)' }}
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
