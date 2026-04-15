import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../../../core/i18n';

interface ConnectionStatusBannerProps {
  isOnline: boolean;
  showZen: boolean;
}

export function ConnectionStatusBanner({ isOnline, showZen }: ConnectionStatusBannerProps) {
  const { t } = useLanguage();
  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ 
            y: showZen ? -20 : 0, 
            opacity: showZen ? 0 : 1 
          }}
          exit={{ y: -20, opacity: 0 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-amber-500 text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2"
        >
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          {t('offline_banner_message')}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
