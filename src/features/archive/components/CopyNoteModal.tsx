import React, { useState, useMemo } from 'react';
import { Copy, Check, X } from 'lucide-react';
import { ModalShell } from '../../../shared/components/ModalShell';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { useToast } from '../../../shared/components/Toast';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { sessionToMarkdown, ExportStrings } from '../../../core/services/ArchiveExportService';
import type { ArchiveSession } from '../types';

export interface CopyNoteModalProps {
  open: boolean;
  onClose: () => void;
  session: ArchiveSession;
}

export function CopyNoteModal({ open, onClose, session }: CopyNoteModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'markdown' | 'text'>('markdown');
  const [copied, setCopied] = useState(false);

  const handleClose = () => {
    setCopied(false);
    setActiveTab('markdown');
    onClose();
  };

  const exportStrings: ExportStrings = useMemo(() => ({
    date: t('export_header_date'),
    words: t('export_header_words'),
    time: t('export_header_time'),
    tags: t('export_header_tags'),
    untitled: t('export_untitled'),
    untitledFilename: t('export_filename_default'),
  }), [t]);

  const markdownContent = useMemo(() => {
    return sessionToMarkdown(session, exportStrings);
  }, [session, exportStrings]);

  const textContent = session.content || '';

  const currentContent = activeTab === 'markdown' ? markdownContent : textContent;

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      void navigator.clipboard.writeText(currentContent);
    }
    setCopied(true);
    showToast(t('archive_copied_toast'), 'success');
    setTimeout(() => {
      setCopied(false);
    }, 1500);
  };

  return (
    <ModalShell open={open} onClose={handleClose} labelId="copy-note-modal-title" className="max-w-2xl bg-surface-card border border-border-subtle rounded-2xl p-5 shadow-2xl space-y-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <div className="flex items-center gap-1.5" role="tablist" aria-label={t('archive_copy_modal_title')}>
          <h3 id="copy-note-modal-title" className="sr-only">
            {t('archive_copy_modal_title')}
          </h3>
          <Button
            role="tab"
            aria-selected={activeTab === 'markdown'}
            onClick={() => setActiveTab('markdown')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs transition-colors duration-150 cursor-pointer",
              activeTab === 'markdown'
                ? "bg-text-main text-surface-base font-semibold shadow-sm"
                : "text-text-main/60 hover:text-text-main/70"
            )}
          >
            {t('archive_copy_tab_markdown')}
          </Button>
          <Button
            role="tab"
            aria-selected={activeTab === 'text'}
            onClick={() => setActiveTab('text')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs transition-colors duration-150 cursor-pointer",
              activeTab === 'text'
                ? "bg-text-main text-surface-base font-semibold shadow-sm"
                : "text-text-main/60 hover:text-text-main/70"
            )}
          >
            {t('archive_copy_tab_text')}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all duration-150 cursor-pointer",
              copied
                ? "bg-accent-success/20 text-accent-success border border-accent-success/30"
                : "bg-text-main text-surface-base hover:opacity-90 shadow-sm"
            )}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? t('archive_copied_button') : t('archive_copy_button')}</span>
          </Button>
          <IconButton
            onClick={handleClose}
            label={t('common_close')}
            icon={<X size={16} />}
            className="p-1.5 rounded-xl text-text-main/60 hover:text-text-main hover:bg-text-main/5 transition-colors"
          />
        </div>
      </div>

      <pre className="font-mono text-xs text-text-main/90 bg-surface-base/80 border border-border-subtle rounded-xl p-4 overflow-auto max-h-[60vh] select-all whitespace-pre-wrap break-words leading-relaxed custom-scrollbar">
        {currentContent}
      </pre>
    </ModalShell>
  );
}
