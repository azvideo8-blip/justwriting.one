import React, { useState, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { KeyRound, Copy, Check, Download, AlertTriangle } from 'lucide-react';
import { useLanguage } from '../i18n';
import { useToast } from './Toast';
import { Button } from './Button';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface RecoveryCodeDisplayModalProps {
  recoveryCode: string;
  onConfirm: (opts: { rememberDevice: boolean }) => void;
  /** R3-9: показать выбор «запомнить на этом устройстве» (сейф, созданный при входе). */
  askRememberDevice?: boolean;
}

export function RecoveryCodeDisplayModal({
  recoveryCode,
  onConfirm,
  askRememberDevice = false,
}: RecoveryCodeDisplayModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const reducedMotion = useReducedMotion();
  const modalRef = useRef<HTMLDivElement>(null);

  const [copied, setCopied] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);

  useFocusTrap(modalRef, true);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      showToast(t('enc_recovery_code_copied'), 'success');
      setTimeout(() => setCopied(false), 3000);
    } catch {
      showToast(t('error_generic'), 'error');
    }
  };

  const handleDownload = () => {
    try {
      const fileContent = `${t('enc_recovery_file_header')}\n\n${recoveryCode}\n\n${t('enc_recovery_file_footer')}`;
      const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'justwriting-recovery-code.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(t('enc_recovery_file_downloaded'), 'success');
    } catch {
      showToast(t('error_generic'), 'error');
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[var(--z-critical)] flex items-center justify-center bg-surface-base/95 backdrop-blur-md p-4"
      >
        <motion.div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="recovery-code-title"
          initial={reducedMotion ? {} : { scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={reducedMotion ? {} : { scale: 0.95, opacity: 0 }}
          className="w-full max-w-[480px] bg-surface-card border border-border-subtle rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-accent-warning/10 border border-accent-warning/30 flex items-center justify-center shrink-0">
              <KeyRound size={20} className="text-accent-warning" />
            </div>
            <div>
              <h2 id="recovery-code-title" className="text-lg font-bold text-text-main">
                {t('enc_recovery_code_title')}
              </h2>
              <p className="text-xs text-text-main/60">
                {t('enc_recovery_code_subtitle')}
              </p>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-accent-warning/10 border border-accent-warning/20 text-accent-warning text-xs flex gap-2.5 items-start">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span className="leading-relaxed">{t('enc_recovery_code_warning')}</span>
          </div>

          <div className="p-4 rounded-2xl bg-surface-base border border-border-subtle text-center space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-main/60">
              {t('enc_recovery_code_label')}
            </div>
            <div className="font-mono text-base sm:text-lg font-bold tracking-wider text-text-main select-all break-all">
              {recoveryCode}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={() => void handleCopy()}
              className="py-2.5 px-3 rounded-xl border border-border-subtle text-xs font-medium text-text-main/80 hover:text-text-main hover:bg-text-main/5 transition-colors flex items-center justify-center gap-2"
            >
              {copied ? <Check size={14} className="text-accent-success" /> : <Copy size={14} />}
              {copied ? t('enc_recovery_code_copied_btn') : t('enc_recovery_code_copy_btn')}
            </Button>

            <Button
              type="button"
              onClick={handleDownload}
              className="py-2.5 px-3 rounded-xl border border-border-subtle text-xs font-medium text-text-main/80 hover:text-text-main hover:bg-text-main/5 transition-colors flex items-center justify-center gap-2"
            >
              <Download size={14} />
              {t('enc_recovery_code_download_btn')}
            </Button>
          </div>

          <div className="pt-2 border-t border-border-subtle space-y-4">
            <label className="flex items-start gap-3 cursor-pointer text-left select-none">
              <input
                type="checkbox"
                checked={savedConfirmed}
                onChange={e => setSavedConfirmed(e.target.checked)}
                className="mt-0.5 accent-[var(--brand-primary)] shrink-0 w-4 h-4"
              />
              <span className="text-xs text-text-main/80 font-medium leading-relaxed">
                {t('enc_recovery_code_confirm_checkbox')}
              </span>
            </label>

            {askRememberDevice && (
              <label className="flex items-start gap-3 cursor-pointer text-left select-none">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={e => setRememberDevice(e.target.checked)}
                  className="mt-0.5 accent-[var(--brand-primary)] shrink-0 w-4 h-4"
                />
                <span className="text-xs text-text-main/80 font-medium leading-relaxed">
                  {t('enc_recovery_remember_device')}
                </span>
              </label>
            )}

            <Button
              type="button"
              disabled={!savedConfirmed}
              onClick={() => onConfirm({ rememberDevice })}
              className="w-full py-3 rounded-xl font-bold hover:brightness-110 active:scale-[0.98] transition-colors disabled:opacity-50 text-white bg-[var(--brand-primary)] text-sm"
            >
              {t('enc_recovery_code_continue_btn')}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
