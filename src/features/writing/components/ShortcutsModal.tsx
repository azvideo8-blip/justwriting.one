import { Keyboard, X } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { useLanguage } from '../../../shared/i18n';

interface ShortcutsModalProps {
  onClose: () => void;
}

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  const { t } = useLanguage();

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';

  const shortcuts: { keys: string; label: string }[] = [
    { keys: `${mod}+P`, label: t('shortcuts_pause_resume') },
    { keys: `${mod}+S`, label: t('shortcuts_save') },
    { keys: `${mod}+Enter`, label: t('shortcuts_finish') },
    { keys: `${mod}+/`, label: t('shortcuts_toggle') },
  ];

  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md mx-4 bg-surface-card border border-border-subtle rounded-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h3 className="text-base font-bold text-text-main flex items-center gap-2">
            <Keyboard size={16} className="text-brand-soft" />
            {t('shortcuts_title')}
          </h3>
          <IconButton onClick={onClose} className="p-2 rounded-lg text-text-main/60 hover:text-text-main transition-colors" label={t('common_close')} icon={<X size={18} />} />
        </div>

        <div className="px-6 py-4 overflow-y-auto">
          <div className="space-y-2.5">
            {shortcuts.map(s => (
              <div key={s.keys} className="flex items-center justify-between">
                <span className="text-sm text-text-main/70">{s.label}</span>
                <kbd className="px-2.5 py-1 text-xs font-mono bg-surface-base/10 rounded-md border border-border-subtle text-text-main/80">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-3.5 border-t border-border-subtle flex justify-end">
          <Button onClick={onClose} className="px-4 py-2 rounded-xl bg-text-main text-surface-base text-xs font-medium hover:bg-text-main/90 transition-colors">
            {t('common_close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
