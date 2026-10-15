import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';

/** MF-8/MF-17: панель над списком заметок на телефоне (теги, календарь) — стоит,
 *  пока её не закроют «×» 44 px в углу. */
export function MobileInlinePanel({ onClose, children, testId, scrollable }: { onClose: () => void; children: ReactNode; testId: string; scrollable?: boolean }) {
  const { t } = useLanguage();
  return (
    <div data-testid={testId} className="relative mt-4 rounded-2xl border border-border-subtle bg-surface-card/25 px-4 py-1 pr-12 shadow-md">
      <button
        type="button"
        onClick={onClose}
        aria-label={t('close')}
        className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-text-main/60"
      >
        <X size={18} aria-hidden="true" />
      </button>
      {/* Панель стоит в неподвижной шапке архива: высокая (календарь) сжала бы
          список до нуля, поэтому она ограничена и прокручивается сама. */}
      {scrollable ? <div className="max-h-[45dvh] overflow-y-auto overscroll-contain">{children}</div> : children}
    </div>
  );
}
