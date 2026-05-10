import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { EditorTab } from './EditorTab';
import { AppTab } from './AppTab';
import { AccountTab } from './AccountTab';

type Tab = 'editor' | 'app' | 'account';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onRefreshLifeLog?: () => void;
}

export function SettingsPanelContent({ userId, onRefreshLifeLog }: { userId: string; onRefreshLifeLog?: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>('editor');
  const { t } = useLanguage();

  const tabs: { id: Tab; label: string }[] = [
    { id: 'editor',  label: t('settings_tab_editor') },
    { id: 'app',     label: t('settings_tab_app') },
    { id: 'account', label: t('settings_tab_account') },
  ];

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center gap-1 px-4 pt-3 pb-2 shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all",
              activeTab === tab.id
                ? "bg-text-main text-surface-base"
                : "text-text-main/50 hover:text-text-main hover:bg-text-main/8"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-28 space-y-4">
        {activeTab === 'editor' && <EditorTab />}
        {activeTab === 'app' && <AppTab userId={userId} onRefreshLifeLog={onRefreshLifeLog} />}
        {activeTab === 'account' && <AccountTab userId={userId} />}
      </div>
    </div>
  );
}

export function SettingsPanel({ isOpen, onClose, userId, onRefreshLifeLog }: SettingsPanelProps) {
  const { t } = useLanguage();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm"
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] z-[70] bg-surface-card border-l border-border-subtle flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle shrink-0">
              <h2 className="text-lg font-bold text-text-main">{t('nav_settings')}</h2>
              <button
                onClick={onClose}
                className="p-3 rounded-xl text-text-main/50 hover:text-text-main hover:bg-text-main/8 transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <SettingsPanelContent userId={userId} onRefreshLifeLog={onRefreshLifeLog} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
