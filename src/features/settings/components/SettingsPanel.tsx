import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { EditorTab } from './EditorTab';
import { AppTab } from './AppTab';
import { AccountTab } from './AccountTab';
import { useFocusTrap } from '../../../shared/hooks/useFocusTrap';
import { useToast } from '../../../shared/components/Toast';
import { APP_VERSION } from '../../../version';

type Tab = 'editor' | 'app' | 'account';

const TAB_IDS: Tab[] = ['editor', 'app', 'account'];

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onRefreshLifeLog?: () => void;
  defaultTab?: Tab;
}

export function SettingsPanelContent({ userId, onRefreshLifeLog, defaultTab }: { userId: string; onRefreshLifeLog?: () => void; defaultTab?: Tab }) {
  const validTab = (defaultTab === 'editor' || defaultTab === 'app' || defaultTab === 'account') ? defaultTab : 'editor';
  const [activeTab, setActiveTab] = useState<Tab>(validTab);
  const { t } = useLanguage();
  const { showToast } = useToast();
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleVersionTap = () => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 3000);
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0;
      sessionStorage.setItem('diagnostics_unlocked', 'true');
      showToast('Режим диагностики активирован', 'success');
    }
  };

  useEffect(() => {
    const el = document.getElementById(`settings-tab-${activeTab}`);
    if (el) el.focus();
  }, [activeTab]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'editor',  label: t('settings_tab_editor') },
    { id: 'app',     label: t('settings_tab_app') },
    { id: 'account', label: t('settings_tab_account') },
  ];

  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    const idx = TAB_IDS.indexOf(activeTab);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActiveTab(TAB_IDS[(idx + 1) % TAB_IDS.length]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActiveTab(TAB_IDS[(idx - 1 + TAB_IDS.length) % TAB_IDS.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveTab(TAB_IDS[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveTab(TAB_IDS[TAB_IDS.length - 1]);
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div
        role="tablist"
        aria-label={t('settings_tabs_label')}
        className="flex items-center gap-1 px-4 pt-3 pb-2 shrink-0"
        onKeyDown={handleTabKeyDown}
      >
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            id={`settings-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`settings-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-text-main text-surface-base"
                : "text-text-main/50 hover:text-text-main hover:bg-text-main/8"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-28 space-y-4">
        <div
          id="settings-panel-editor"
          role="tabpanel"
          aria-labelledby="settings-tab-editor"
          hidden={activeTab !== 'editor'}
          className="contents"
        >
          <EditorTab />
        </div>
        <div
          id="settings-panel-app"
          role="tabpanel"
          aria-labelledby="settings-tab-app"
          hidden={activeTab !== 'app'}
          className="contents"
        >
          <AppTab userId={userId} onRefreshLifeLog={onRefreshLifeLog} />
        </div>
        <div
          id="settings-panel-account"
          role="tabpanel"
          aria-labelledby="settings-tab-account"
          hidden={activeTab !== 'account'}
          className="contents"
        >
          <AccountTab userId={userId} />
        </div>

        <div className="pt-6 text-center">
          <span
            onClick={handleVersionTap}
            className="text-xs text-text-main/20 select-none cursor-default"
          >
            v{APP_VERSION}
          </span>
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel({ isOpen, onClose, userId, onRefreshLifeLog, defaultTab }: SettingsPanelProps) {
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
            initial={{ x: reducedMotion ? 0 : '100%' }}
            animate={{ x: 0 }}
            exit={{ x: reducedMotion ? 0 : '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] z-[var(--z-panel)] bg-surface-card border-l border-border-subtle flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle shrink-0">
              <h2 id="settings-title" className="text-lg font-bold text-text-main">{t('nav_settings')}</h2>
              <button
                onClick={onClose}
                aria-label={t('common_close')}
                className="p-3 rounded-xl text-text-main/50 hover:text-text-main hover:bg-text-main/8 transition-colors"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <SettingsPanelContent key={defaultTab ?? 'editor'} userId={userId} onRefreshLifeLog={onRefreshLifeLog} defaultTab={defaultTab} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
