import { motion } from 'motion/react';
import { WifiOff } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';

interface ConnectionStatusBannerProps {
  isOnline: boolean;
  showZen?: boolean;
}

export function ConnectionStatusBanner({ isOnline, showZen }: ConnectionStatusBannerProps) {
  const { t } = useLanguage();

  if (isOnline || showZen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={cn(
        "fixed top-4 left-1/2 -translate-x-1/2 z-[60]",
        "flex items-center gap-2 px-4 py-2 rounded-2xl",
        "bg-amber-500/10 border border-amber-500/30 backdrop-blur-xl",
        "text-amber-400 text-sm font-medium whitespace-nowrap"
      )}
    >
      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
      <WifiOff size={16} className="shrink-0" />
      <span>{t('offline_banner_message')}</span>
    </motion.div>
  );
}
