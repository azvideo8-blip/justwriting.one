import React from 'react';
import { motion } from 'motion/react';
import { useLanguage } from '../../../../core/i18n';
import { cn } from '../../../../core/utils/utils';

interface PasswordPromptModalProps {
  isOpen: boolean;
  isV2: boolean;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

export function PasswordPromptModal({
  isOpen,
  isV2,
  onConfirm,
  onCancel
}: PasswordPromptModalProps) {
  const { t } = useLanguage();
  const [password, setPassword] = React.useState('');

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
    <div className={cn(
      "fixed inset-0 z-[150] flex items-center justify-center p-4", 
      isV2 ? "bg-[#0A0A0B]/90 backdrop-blur-3xl" : "bg-stone-900/80 backdrop-blur-xl"
    )}>
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn(
          "w-full max-w-sm rounded-[2.5rem] p-8 md:p-10 shadow-2xl space-y-6 border", 
          isV2 ? "bg-[#0A0A0B] border-white/10" : "bg-white dark:bg-stone-900 border-transparent"
        )}
      >
        <div className="text-center space-y-2">
          <h3 className={cn("text-xl font-black", isV2 ? "text-white" : "dark:text-stone-100")}>
            {t('writing_enter_password')}
          </h3>
          <p className={cn("text-xs", isV2 ? "text-white/50" : "text-stone-500")}>
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
            className={cn(
              "w-full p-4 rounded-2xl border transition-all outline-none text-center font-mono",
              isV2 
                ? "bg-white/5 border-white/10 text-white focus:bg-white/10 focus:border-white/20" 
                : "bg-stone-50 dark:bg-stone-800/50 border-stone-100 dark:border-stone-800 focus:border-stone-900 dark:focus:border-stone-100"
            )}
            autoFocus
          />
          
          <div className="flex gap-3">
            <button 
              onClick={handleCancel}
              className={cn(
                "flex-1 px-4 py-3 rounded-xl font-bold transition-all border", 
                isV2 ? "border-white/10 text-white hover:bg-white/5" : "border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800"
              )}
            >
              {t('writing_cancel')}
            </button>
            <button 
              onClick={handleConfirm}
              className={cn(
                "flex-1 px-4 py-3 rounded-xl font-bold transition-all", 
                isV2 ? "bg-white text-black" : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900"
              )}
            >
              {t('writing_decrypt')}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
