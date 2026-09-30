import type { DragEvent, DragEventHandler } from 'react';
import { Upload } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useLanguage } from '../../../shared/i18n';

interface ImportDropOverlayProps {
  onDragEnter: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
}

/** DC-A6: иконка больше не подпрыгивает — оверлей появляется фейдом за 150 мс,
 *  при prefers-reduced-motion оверлей просто появляется без анимации. */
export function ImportDropOverlay({ onDragEnter, onDragOver, onDragLeave, onDrop }: ImportDropOverlayProps) {
  const { t } = useLanguage();
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-0 z-[var(--z-overlay)] flex flex-col items-center justify-center bg-surface-base/85 backdrop-blur-sm border-2 border-dashed border-brand-soft m-4 rounded-3xl"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex flex-col items-center gap-4 text-center pointer-events-none">
        <div className="w-16 h-16 rounded-full bg-brand-soft/10 flex items-center justify-center text-brand-soft">
          <Upload size={32} />
        </div>
        <div>
          <p className="text-lg font-bold text-text-main">{t('archive_import_drop_title')}</p>
          <p className="text-sm text-text-main/60 mt-1">{t('archive_import_drop_hint')}</p>
        </div>
      </div>
    </motion.div>
  );
}
