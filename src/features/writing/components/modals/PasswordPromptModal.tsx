import React from 'react';
import { motion } from 'motion/react';
import { useLanguage } from '../../../../core/i18n';
import { useModalEscape } from '../../../../shared/hooks/useModalEscape';

interface PasswordPromptModalProps {
  isOpen: boolean;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

export function PasswordPromptModal({
  isOpen,
  onConfirm,
  onCancel
}: PasswordPromptModalProps) {
  const { t } = useLanguage();
  const [password, setPassword] = React.useState('');

  useModalEscape(isOpen, onCancel);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm(password);
    setPassword('');
  };

  const handleCancel = () => {
    onCancel();
    setPassword('');
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-surface-base/90 backdrop-blur-3xl">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-sm rounded-3xl p-8 md:p-10 shadow-2xl space-y-6 border bg-surface-card border-border-subtle"
      >
        <div className="text-center space-y-2">
          <h3 className="text-xl font-black text-text-main">
            {t('writing_enter_password')}
          </h3>
          <p className="text-xs text-text-main/50">
            {t('writing_decrypt_desc')}
          </p>
        </div>
        
        <div className="space-y-4">
          <input 
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
            placeholder="••••••••"
            className="w-full p-4 rounded-2xl border transition-all outline-none text-center font-mono bg-surface-base/5 border-border-subtle text-text-main focus:bg-surface-base/10 focus:border-border-subtle/20"
            autoFocus
          />
          
          <div className="flex gap-3">
            <button 
              onClick={handleCancel}
              className="flex-1 px-4 py-3 rounded-xl font-bold transition-all border border-border-subtle text-text-main hover:bg-surface-base/5"
            >
              {t('writing_cancel')}
            </button>
            <button 
              onClick={handleConfirm}
              className="flex-1 px-4 py-3 rounded-xl font-bold transition-all bg-text-main text-surface-base"
            >
              {t('writing_decrypt')}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
