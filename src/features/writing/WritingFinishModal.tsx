import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Download, FileText } from 'lucide-react';
import { cn } from '../../core/utils/utils';
import { ExportService } from '../export/ExportService';
import { Label } from '../../types';
import { useLanguage } from '../../core/i18n';
import { formatTime } from '../../core/utils/formatTime';
import { useServiceAction } from './hooks/useServiceAction';

import { useWritingStore } from './store/useWritingStore';
import { useModalEscape } from '../../shared/hooks/useModalEscape';

export interface SaveData {
  title: string;
  tags: string[];
  labelId?: string;
}

interface WritingFinishModalProps {
  isOpen: boolean;
  tags: string[];
  setTags: (tags: string[]) => void;
  labelId?: string;
  setLabelId: (labelId?: string) => void;
  labels: Label[];
  isGuest: boolean;
  onSave: (data: SaveData) => Promise<void>;
}

export function WritingFinishModal({
  isOpen,
  tags,
  setTags,
  labelId,
  setLabelId,
  labels,
  isGuest: _isGuest,
  onSave,
}: WritingFinishModalProps) {
  const { t } = useLanguage();
  const { execute, isLoading: isSaving } = useServiceAction();

  const status = useWritingStore(s => s.status);
  const setStatus = useWritingStore(s => s.setStatus);
  const wordCount = useWritingStore(s => s.wordCount);
  const seconds = useWritingStore(s => s.seconds);
  const wpm = useWritingStore(s => s.wpm);
  const content = useWritingStore(s => s.content);
  const title = useWritingStore(s => s.title);

  useModalEscape(status === 'finished', () => setStatus('writing'));

  const [editTitle, setEditTitle] = useState('');
  const titleInputValue = editTitle || title || '';

  const popularWords = React.useMemo(() => {
    const words = content.toLowerCase().match(/\b\w{5,}\b/g) || [];
    const freq: Record<string, number> = {};
    words.forEach(w => freq[w] = (freq[w] || 0) + 1);
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(e => e[0]);
  }, [content]);

  const allSuggestions = React.useMemo(() => {
    const suggestions = new Set([(title || '').trim(), ...popularWords].filter(Boolean));
    return Array.from(suggestions);
  }, [title, popularWords]);

  if (!isOpen || status !== 'finished') return null;

  const toggleTag = (tag: string) => {
    if (!tags) return;
    if (tags.includes(tag)) {
      setTags(tags.filter(t => t !== tag));
    } else {
      setTags([...tags, tag]);
    }
  };

  const exportPDF = () => ExportService.toPDF(title || 'Untitled', content);
  const exportMarkdown = () => ExportService.toMarkdown(title || 'Untitled', content);
  const exportDocx = () => {
    execute(() => ExportService.toDocx(title || 'Untitled', content), { errorMessage: t('error_export_failed') });
  };

  const finalTitle = titleInputValue.trim() || title || '';

  const saveData: SaveData = {
    title: finalTitle,
    tags: tags || [],
    labelId,
  };

  const handleSaveClick = () => {
    if (finalTitle && finalTitle !== title) {
      useWritingStore.getState().setTitle(finalTitle);
    }
    execute(
      () => onSave({ ...saveData, title: finalTitle }),
      { successMessage: t('save_success'), errorMessage: t('error_save_failed') }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-base/80 backdrop-blur-2xl">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-lg rounded-3xl p-8 space-y-5 max-h-[90vh] overflow-y-auto no-scrollbar bg-surface-card backdrop-blur-2xl border border-border-subtle text-text-main shadow-[0_0_60px_rgba(0,0,0,0.8)]"
      >
        <div className="text-center">
          <h3 className="text-2xl font-bold text-text-main">{t('finish_congrats')}</h3>
        </div>

        <div className="grid grid-cols-3 gap-4 text-center divide-x divide-border-subtle">
          <div className="p-2">
            <div className="text-[11px] font-bold uppercase tracking-widest mb-1 text-text-main/50">{t('writing_words')}</div>
            <div className="text-xl font-mono font-bold text-text-main">{wordCount}</div>
          </div>
          <div className="p-2">
            <div className="text-[11px] font-bold uppercase tracking-widest mb-1 text-text-main/50">{t('writing_time')}</div>
            <div className="text-xl font-mono font-bold text-text-main">{formatTime(seconds)}</div>
          </div>
          <div className="p-2">
            <div className="text-[11px] font-bold uppercase tracking-widest mb-1 text-text-main/50">{t('writing_wpm')}</div>
            <div className="text-xl font-mono font-bold text-text-main">{wpm}</div>
          </div>
        </div>

        <div className="space-y-2">
          <input
            type="text"
            value={titleInputValue}
            onChange={e => setEditTitle(e.target.value)}
            placeholder={t('editor_title_placeholder')}
            className="w-full px-4 py-3 rounded-2xl border outline-none transition-all bg-surface-base border-border-subtle text-text-main text-lg font-medium placeholder:text-text-main/30 focus:border-text-main/40"
            autoFocus
          />
        </div>

        {labels.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-text-main/50">{t('finish_labels')}</div>
            <div className="flex flex-wrap gap-2">
              {labels.map(label => (
                <button
                  key={label.id}
                  onClick={() => setLabelId(labelId === label.id ? undefined : label.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                    labelId === label.id
                      ? "ring-2 ring-offset-2 ring-offset-surface-base"
                      : "hover:opacity-80"
                  )}
                  style={{ backgroundColor: label.color, outlineColor: label.color }}
                >
                  {label.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-text-main/50">{t('finish_tags')}</div>
          <div className="flex flex-wrap gap-2">
            {allSuggestions.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                  tags && tags.includes(tag)
                    ? "bg-text-main text-surface-base"
                    : "bg-surface-base text-text-main/70 hover:bg-white/10"
                )}
              >
                #{tag}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder={t('finish_add_tag')}
            className="w-full px-4 py-2 rounded-2xl border outline-none transition-all bg-surface-base border-border-subtle text-text-main placeholder:text-text-main/60 focus:border-text-main/40"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const val = e.currentTarget.value.trim();
                if (val && tags && !tags.includes(val)) {
                  setTags([...tags, val]);
                  e.currentTarget.value = '';
                }
              }
            }}
          />
        </div>

        <div className="space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-text-main/50">{t('session_export')}</div>
          <div className="grid grid-cols-3 gap-3">
            <button onClick={exportPDF} className="flex flex-col items-center gap-2 p-3 transition-all rounded-2xl bg-surface-base hover:bg-white/10 border border-border-subtle">
              <FileText size={18} className="text-text-main/70" />
              <span className="text-[10px] font-bold text-text-main/70">PDF</span>
            </button>
            <button onClick={exportMarkdown} className="flex flex-col items-center gap-2 p-3 transition-all rounded-2xl bg-surface-base hover:bg-white/10 border border-border-subtle">
              <FileText size={18} className="text-text-main/70" />
              <span className="text-[10px] font-bold text-text-main/70">MD</span>
            </button>
            <button onClick={exportDocx} className="flex flex-col items-center gap-2 p-3 transition-all rounded-2xl bg-surface-base hover:bg-white/10 border border-border-subtle">
              <Download size={18} className="text-text-main/70" />
              <span className="text-[10px] font-bold text-text-main/70">DOCX</span>
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setStatus('writing')}
            className="flex-1 px-6 py-4 font-bold transition-all rounded-2xl border border-border-subtle text-text-main hover:bg-white/5"
          >
            {t('finish_back')}
          </button>
          <button
            onClick={handleSaveClick}
            disabled={isSaving}
            className={cn(
              "flex-1 px-6 py-4 font-bold transition-all bg-text-main text-surface-base rounded-2xl shadow-[0_0_20px_rgba(255,255,255,0.2)]",
              isSaving ? "opacity-60 cursor-not-allowed" : "hover:scale-105"
            )}
          >
            {isSaving ? t('archive_loading') : t('common_save')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
