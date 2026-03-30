import React from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { useLanguage } from '../../../../core/i18n';
import { cn } from '../../../../core/utils/utils';

interface CancelConfirmModalProps {
  isOpen: boolean;
  isV2: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CancelConfirmModal({
  isOpen,
  isV2,
  onConfirm,
  onCancel
}: CancelConfirmModalProps) {
  const { t } = useLanguage();

  if (!isOpen) return null;

  return (
    <div className={cn(
      "fixed inset-0 z-[60] flex items-center justify-center p-4", 
      isV2 ? "bg-[#0A0A0B]/80 backdrop-blur-2xl" : "bg-stone-900/60 backdrop-blur-md"
    )}>
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn(
          "w-full max-w-sm rounded-3xl p-8 shadow-2xl space-y-6 text-center border", 
          isV2 ? "bg-[#0A0A0B]/90 backdrop-blur-2xl border-white/10 shadow-[0_0_40px_rgba(255,255,255,0.05)]" : "bg-white dark:bg-stone-900 border-transparent"
        )}
      >
        <div className={cn(
          "w-16 h-16 rounded-full flex items-center justify-center mx-auto", 
          isV2 ? "bg-red-500/10 text-red-500" : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
        )}>
          <X size={32} />
        </div>
        <div className="space-y-2">
          <h3 className={cn("text-xl font-bold", isV2 ? "text-white" : "dark:text-stone-100")}>
            {t('writing_cancel_confirm')}
          </h3>
          <p className={cn("text-sm", isV2 ? "text-white/50" : "text-stone-500 dark:text-stone-400")}>
            {t('writing_cancel_desc')}
          </p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={onCancel}
            className={cn(
              "flex-1 px-4 py-3 rounded-xl font-bold transition-all border", 
              isV2 ? "border-white/10 text-white hover:bg-white/5" : "border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800"
            )}
          >
            {t('writing_back')}
          </button>
          <button 
            onClick={onConfirm}
            className={cn(
              "flex-1 px-4 py-3 rounded-xl font-bold transition-all", 
              isV2 ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-600 text-white hover:bg-red-700"
            )}
          >
            {t('finish_discard')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
