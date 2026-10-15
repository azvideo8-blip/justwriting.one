import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useLanguage } from '../../../shared/i18n';
import { SECTION_LABEL } from '../../../shared/components/ModalShell';

/** MF-8/MF-17: панель над списком заметок на телефоне (теги, календарь) — стоит,
 *  пока её не закроют «×» 44 px в углу. MQ-8: одна плоская поверхность; «×» делит
 *  строку с названием панели, а не держит мёртвую колонку справа от содержимого;
 *  своей прокрутки у панели нет — высокую (календарь) прокручивает колонка архива. */
export function MobileInlinePanel({ onClose, children, testId, title }: { onClose: () => void; children: ReactNode; testId: string; title: string }) {
  const { t } = useLanguage();
  return (
    // MQ-15 (N-7): панель проступает за 200 мс, а не появляется рывком под уходящим листом.
    <motion.div
      data-testid={testId}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="mt-4 rounded-2xl border border-border-subtle bg-surface-card/25 shadow-md"
    >
      <div className="flex items-center justify-between pl-4">
        <span className={SECTION_LABEL}>{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="press flex h-11 w-11 items-center justify-center text-text-main/60"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="px-4 pb-3">{children}</div>
    </motion.div>
  );
}
