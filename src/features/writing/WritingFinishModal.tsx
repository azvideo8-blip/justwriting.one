import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Globe, User as UserIcon, FileText, Download, FileJson, Plus, Layers, HardDrive, Cloud } from 'lucide-react';
import { cn } from '../../core/utils/utils';
import { ExportService } from '../export/ExportService';
import { Label, Document } from '../../types';
import { useLanguage } from '../../core/i18n';
import { formatTime } from '../../core/utils/formatTime';
import { Toggle } from '../../shared/components/Toggle';
import { useServiceAction } from './hooks/useServiceAction';
import { SessionSource } from './hooks/useSessionSource';
import { useSettings } from '../../core/settings/SettingsContext';

import { useWritingStore } from './store/useWritingStore';
import { useModalEscape } from '../../shared/hooks/useModalEscape';

export interface SaveData {
  title: string;
  isPublic: boolean;
  isAnonymous: boolean;
  tags: string[];
  labelId?: string;
}

type ModalStep = 'choose' | 'new' | 'continue';

interface WritingFinishModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  setTitle: (title: string) => void;
  sessionType: string;
  wordCount: number;
  duration: number;
  isPublic: boolean;
  setIsPublic: (val: boolean) => void;
  isAnonymous: boolean;
  setIsAnonymous: (val: boolean) => void;
  handleSave: (isLocalOnly: boolean) => void;
  tags: string[];
  setTags: (tags: string[]) => void;
  labelId?: string;
  setLabelId: (labelId?: string) => void;
  labels: Label[];
  isLocalOnly: boolean;
  existingDocuments: Document[];
  onSaveAsNew: (data: SaveData) => Promise<void>;
  onSaveAsVersion: (documentId: string, data: SaveData) => Promise<void>;
  effectiveSource: SessionSource;
}

export function WritingFinishModal({
  isOpen,
  onClose: _onClose,
  onConfirm: _onConfirm,
  title: _title,
  setTitle: _setTitle,
  sessionType: _sessionType,
  wordCount: _wordCount,
  duration: _duration,
  isPublic,
  setIsPublic,
  isAnonymous,
  setIsAnonymous,
  handleSave,
  tags,
  setTags,
  labelId,
  setLabelId,
  labels,
  isLocalOnly,
  existingDocuments,
  onSaveAsNew,
  onSaveAsVersion,
  effectiveSource,
}: WritingFinishModalProps) {
  const { t } = useLanguage();
  const { execute } = useServiceAction();
  const { openSettings } = useSettings();

  const [step, setStep] = useState<ModalStep>('choose');

  const renderStorageHint = () => (
    <div className="flex items-center gap-1.5 text-[11px] text-text-main/30 mt-2">
      {effectiveSource === 'local' && <><HardDrive size={11} /> {t('finish_saving_to_local')}</>}
      {effectiveSource === 'cloud' && <><Cloud size={11} /> {t('finish_saving_to_cloud')}</>}
      {effectiveSource === 'both'  && <><HardDrive size={11} /><Cloud size={11} /> {t('finish_saving_to_both')}</>}
      <span className="ml-1 underline cursor-pointer" onClick={openSettings}>
        {t('finish_change_in_settings')}
      </span>
    </div>
  );
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  const status = useWritingStore(s => s.status);
  const setStatus = useWritingStore(s => s.setStatus);
  const wordCount = useWritingStore(s => s.wordCount);
  const seconds = useWritingStore(s => s.seconds);
  const wpm = useWritingStore(s => s.wpm);
  const content = useWritingStore(s => s.content);
  const title = useWritingStore(s => s.title);

  useModalEscape(status === 'finished', () => setStatus('writing'));

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

  const exportPDF = () => {
    ExportService.toPDF(title || 'Untitled Session', content);
  };

  const exportMarkdown = () => {
    ExportService.toMarkdown(title || 'Untitled Session', content);
  };

  const exportDocx = () => {
    execute(
      () => ExportService.toDocx(title || 'Untitled Session', content),
      { errorMessage: t('error_export_failed') }
    );
  };

  const handleSaveClick = () => {
    handleSave(isLocalOnly);
  };

  const saveData: SaveData = {
    title: title || '',
    isPublic,
    isAnonymous,
    tags: tags || [],
    labelId,
  };

  const handleNewSave = () => {
    execute(
      () => onSaveAsNew(saveData),
      { successMessage: t('save_success'), errorMessage: t('error_save_failed') }
    );
  };

  const handleContinueSave = () => {
    if (!selectedDocumentId) return;
    execute(
      () => onSaveAsVersion(selectedDocumentId, saveData),
      { successMessage: t('save_success'), errorMessage: t('error_save_failed') }
    );
  };

  const renderTagSection = () => (
    <div className="space-y-4">
      <div className="text-sm font-bold uppercase tracking-wider text-text-main/50">{t('finish_tags')}</div>
      <div className="flex flex-wrap gap-2">
        {allSuggestions.map(tag => (
          <button
            key={tag}
            onClick={() => toggleTag(tag)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1",
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
        className="w-full px-4 py-2 rounded-2xl border outline-none transition-all bg-surface-base border-border-subtle text-text-main placeholder-text-main/60 focus:border-text-main/40 focus:bg-white/10"
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
  );

  const renderStatsSection = () => (
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
  );

  const renderLabelSection = () => (
    <div className="space-y-4">
      <div className="text-sm font-bold uppercase tracking-wider text-text-main/50">{t('finish_labels')}</div>
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
  );

  const renderExportSection = () => (
    <div className="space-y-3">
      <label className="text-[11px] font-bold uppercase tracking-widest text-text-main/50">{t('session_export')}</label>
      <div className="grid grid-cols-3 gap-3">
        <button onClick={exportPDF} className="flex flex-col items-center gap-2 p-4 transition-all rounded-2xl bg-surface-base hover:bg-white/10 border border-border-subtle">
          <FileText size={20} className="text-text-main/70" />
          <span className="text-[11px] font-bold text-text-main/70">PDF</span>
        </button>
        <button onClick={exportMarkdown} className="flex flex-col items-center gap-2 p-4 transition-all rounded-2xl bg-surface-base hover:bg-white/10 border border-border-subtle">
          <FileJson size={20} className="text-text-main/70" />
          <span className="text-[11px] font-bold text-text-main/70">MD</span>
        </button>
        <button onClick={exportDocx} className="flex flex-col items-center gap-2 p-4 transition-all rounded-2xl bg-surface-base hover:bg-white/10 border border-border-subtle">
          <Download size={20} className="text-text-main/70" />
          <span className="text-[11px] font-bold text-text-main/70">DOCX</span>
        </button>
      </div>
    </div>
  );

  const renderVisibilitySection = () => {
    if (isLocalOnly) {
      return (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl space-y-3 bg-surface-base border border-border-subtle">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 text-text-main/70">
                <FileText size={20} />
              </div>
              <div>
                <div className="font-bold text-sm text-text-main">{t('writing_local_session')}</div>
                <div className="text-xs text-text-main/50">{t('writing_local_desc')}</div>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 rounded-2xl bg-surface-base border border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 text-text-main/70">
              <Globe size={20} />
            </div>
            <div>
              <div className="font-bold text-sm text-text-main">{t('finish_public')}</div>
              <div className="text-xs text-text-main/50">{t('finish_public_desc')}</div>
            </div>
          </div>
          <Toggle checked={isPublic} onChange={setIsPublic} />
        </div>
        <div className="flex items-center justify-between p-4 rounded-2xl bg-surface-base border border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 text-text-main/70">
              <UserIcon size={20} />
            </div>
            <div>
              <div className="font-bold text-sm text-text-main">{t('finish_anonymous')}</div>
              <div className="text-xs text-text-main/50">{t('finish_anonymous_desc')}</div>
            </div>
          </div>
          <Toggle checked={isAnonymous} onChange={setIsAnonymous} />
        </div>
      </div>
    );
  };

  const renderBottomButtons = (onSave: () => void, backAction?: () => void) => (
    <div className="flex gap-3">
      <button
        onClick={backAction || (() => setStatus('writing'))}
        className="flex-1 px-6 py-4 font-bold transition-all rounded-2xl border border-border-subtle text-text-main hover:bg-white/5"
      >
        {backAction ? t('writing_cancel') : t('finish_back')}
      </button>
      <button
        onClick={onSave}
        className="flex-1 px-6 py-4 font-bold transition-all bg-text-main text-surface-base rounded-2xl shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:scale-105"
      >
        {t('common_save')}
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-base/80 backdrop-blur-2xl">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-lg rounded-3xl p-8 space-y-6 max-h-[90vh] overflow-y-auto no-scrollbar bg-surface-card backdrop-blur-2xl border border-border-subtle text-text-main shadow-[0_0_60px_rgba(0,0,0,0.8)]"
      >
        {step === 'choose' && (
          <>
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-bold text-text-main">{t('finish_congrats')}</h3>
            </div>
            {renderStatsSection()}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setStep('new')}
                className="flex items-center gap-4 p-4 rounded-2xl border border-border-subtle hover:bg-text-main/5 text-left transition-all"
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 text-text-main/70 shrink-0">
                  <Plus size={20} />
                </div>
                <div>
                  <span className="text-sm font-medium">{t('finish_modal_new_doc')}</span>
                  <span className="block text-xs text-text-main/40">{t('finish_modal_new_doc_hint')}</span>
                </div>
              </button>
              {existingDocuments.length > 0 && (
                <button
                  onClick={() => setStep('continue')}
                  className="flex items-center gap-4 p-4 rounded-2xl border border-border-subtle hover:bg-text-main/5 text-left transition-all"
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 text-text-main/70 shrink-0">
                    <Layers size={20} />
                  </div>
                  <div>
                    <span className="text-sm font-medium">{t('finish_modal_continue_doc')}</span>
                    <span className="block text-xs text-text-main/40">{t('finish_modal_continue_doc_hint')}</span>
                  </div>
                </button>
              )}
              {/* Legacy save option */}
              <button
                onClick={handleSaveClick}
                className="flex items-center gap-4 p-4 rounded-2xl border border-border-subtle hover:bg-text-main/5 text-left transition-all"
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 text-text-main/70 shrink-0">
                  <FileText size={20} />
                </div>
                <div>
                  <span className="text-sm font-medium">{t('common_save')}</span>
                  <span className="block text-xs text-text-main/40">{t('finish_modal_save_legacy_hint')}</span>
                </div>
              </button>
            </div>
            {renderExportSection()}
            {renderBottomButtons(handleSaveClick, () => setStatus('writing'))}
          </>
        )}

        {step === 'new' && (
          <>
            <div className="text-center space-y-2">
              <h3 className="text-lg font-bold text-text-main">{t('finish_modal_new_doc')}</h3>
            </div>
            {renderLabelSection()}
            {renderTagSection()}
            {renderStatsSection()}
            {renderStorageHint()}
            {renderVisibilitySection()}
            {renderExportSection()}
            {renderBottomButtons(handleNewSave, () => setStep('choose'))}
          </>
        )}

        {step === 'continue' && (
          <>
            <div className="text-center space-y-2">
              <h3 className="text-lg font-bold text-text-main">{t('finish_modal_select_doc')}</h3>
            </div>
            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
              {existingDocuments.map(doc => (
                <button
                  key={doc.id}
                  onClick={() => setSelectedDocumentId(doc.id)}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-xl border transition-all text-left",
                    selectedDocumentId === doc.id
                      ? "border-text-main/40 bg-text-main/5"
                      : "border-border-subtle hover:bg-text-main/5"
                  )}
                >
                  <div>
                    <div className="text-sm font-medium">{doc.title || t('editor_title_placeholder')}</div>
                    <div className="text-xs text-text-main/40">
                      v{doc.currentVersion} · {doc.totalWords.toLocaleString()} {t('home_words_short')} · {doc.sessionsCount} {t('lifelog_sessions_count')}
                    </div>
                  </div>
                  {selectedDocumentId === doc.id && (
                    <div className="w-2 h-2 rounded-full bg-text-main" />
                  )}
                </button>
              ))}
            </div>
            {renderLabelSection()}
            {renderTagSection()}
            {renderStatsSection()}
            {renderStorageHint()}
            {renderExportSection()}
            <button
              onClick={handleContinueSave}
              disabled={!selectedDocumentId}
              className="w-full py-4 rounded-2xl bg-text-main text-surface-base text-sm font-bold disabled:opacity-40 transition-all hover:scale-[1.02]"
            >
              {t('finish_modal_add_version')}
            </button>
            <button
              onClick={() => setStep('choose')}
              className="w-full py-3 rounded-2xl border border-border-subtle text-sm font-medium text-text-main/70 hover:bg-text-main/5 transition-all"
            >
              {t('writing_cancel')}
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}
