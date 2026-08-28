import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { EditorTab } from './EditorTab';
import { useFocusTrap } from '../../../shared/hooks/useFocusTrap';
import { APP_VERSION } from '../../../version';
import { IconButton } from '../../../shared/components/IconButton';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string | undefined;
  onRefreshLifeLog?: (() => void) | undefined;
  defaultTab?: string | undefined;
}

export function SettingsPanelContent({ userId: _userId, onRefreshLifeLog: _onRefreshLifeLog }: { userId?: string | undefined; onRefreshLifeLog?: (() => void) | undefined; activeTab?: string | undefined; setActiveTab?: (tab: string) => void }) {
  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-28 space-y-4">
        <EditorTab />

        <div className="pt-6 text-center">
          <span className="text-xs text-text-main/40 select-none">
            v{APP_VERSION}
          </span>
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel({ isOpen, onClose, userId, onRefreshLifeLog }: SettingsPanelProps) {
  const { t } = useLanguage();
  const panelRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useFocusTrap(panelRef, isOpen);

  useEffect(() => {
    if (isOpen) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* not-a-modal: slide-over panel backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[var(--z-overlay)] bg-black/30 backdrop-blur-sm"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            initial={{ transform: reducedMotion ? "translateX(0px)" : "translateX(100%)" }}
            animate={{ transform: "translateX(0px)" }}
            exit={{ transform: reducedMotion ? "translateX(0px)" : "translateX(100%)" }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] z-[var(--z-panel)] bg-surface-card border-l border-border-subtle flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle shrink-0">
              <h2 id="settings-title" className="text-lg font-bold text-text-main">{t('settings_tab_editor')}</h2>
              <IconButton
                onClick={onClose}
                label={t('common_close')}
                className="p-3 rounded-xl text-text-main/60 hover:text-text-main hover:bg-text-main/8 transition-colors"
                icon={<X size={20} aria-hidden="true" />}
              />
            </div>

            <SettingsPanelContent userId={userId} onRefreshLifeLog={onRefreshLifeLog} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
