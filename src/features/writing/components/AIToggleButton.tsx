import { Sparkles } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { IconButton } from '../../../shared/components/IconButton';
import { cn } from '../../../core/utils/utils';

export function AIToggleButton({ onClick, active }: { onClick: () => void; active: boolean }) {
  const { t } = useLanguage();
  return (
    <IconButton
      icon={<Sparkles size={16} />}
      label={t('ai_toggle')}
      onClick={onClick}
      active={active}
      className={cn(
        "rounded-lg",
        active
          ? "bg-brand-soft/20 text-brand-soft"
          : "text-text-main/60 hover:text-text-main hover:bg-text-main/5"
      )}
    />
  );
}
