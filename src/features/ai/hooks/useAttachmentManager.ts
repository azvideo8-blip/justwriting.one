import { useState, useCallback, useRef, useEffect, type ChangeEvent } from 'react';
import { API_MSG_CAP } from './useAIChat';
import { reportError } from '../../../shared/errors/reportError';
import { useLanguage } from '../../../shared/i18n';

interface AttachmentManagerParams {
  prepareAttachment: (docId: string) => Promise<{ title: string; content: string; lastSessionAt?: number | undefined } | null>;
  sendMessage: (text: string) => Promise<string | null>;
  activeDialogueId: string | null;
  setActiveDialogueId: (id: string | null) => void;
  loadDialogues: () => Promise<void>;
  alertDialog: (options: { title: string; message: string }) => Promise<void>;
  inputText: string;
  setInputText: (text: string) => void;
}

export function useAttachmentManager({
  prepareAttachment,
  sendMessage,
  activeDialogueId,
  setActiveDialogueId,
  loadDialogues,
  alertDialog,
  inputText,
  setInputText,
}: AttachmentManagerParams) {
  const { t } = useLanguage();
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<{ documentId: string; title: string; content: string; lastSessionAt?: number | undefined }[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const dismiss = (e: MouseEvent) => {
      if (
        attachMenuRef.current &&
        !attachMenuRef.current.contains(e.target as Node) &&
        !fileInputRef.current?.contains(e.target as Node)
      ) {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [attachMenuOpen]);

  const removePendingAttachment = useCallback((index: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleDocSelect = useCallback(async (documentId: string) => {
    try {
      const prepared = await prepareAttachment(documentId);
      if (prepared) {
        setPendingAttachments(prev => [...prev, { documentId, title: prepared.title, content: prepared.content, lastSessionAt: prepared.lastSessionAt }]);
      }
      setDocPickerOpen(false);
      setAttachMenuOpen(false);
    } catch (e) {
      reportError(e, { action: 'useAttachmentManager/prepareAttachment', documentId });
    }
  }, [prepareAttachment]);

  const handlePasteAsNote = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setPendingAttachments(prev => [...prev, { documentId: `pasted-${Date.now()}`, title: 'Вставленный текст', content: text }]);
    setInputText('');
  }, [inputText, setInputText]);

  const handleFileUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_FILE_SIZE = 1_048_576;
    if (file.size > MAX_FILE_SIZE) {
      void alertDialog({ title: t('ai_file_too_large_title'), message: t('ai_file_too_large_max_1mb') });
      e.target.value = '';
      setAttachMenuOpen(false);
      return;
    }
    const allowedTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html'];
    const allowedExts = ['.txt', '.md', '.csv', '.json', '.html', '.xml'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
      void alertDialog({ title: t('ai_file_unsupported_title'), message: t('ai_file_unsupported_message', { exts: allowedExts.join(', ') }) });
      e.target.value = '';
      setAttachMenuOpen(false);
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = typeof ev.target?.result === 'string' ? ev.target.result : '';
      const formatted = `[Прикреплен файл: "${file.name}"]\n\n${text}`;
      if (formatted.length > API_MSG_CAP) {
        void alertDialog({ title: t('ai_file_too_large_title'), message: t('ai_file_too_large_chars', { count: API_MSG_CAP.toLocaleString() }) });
        return;
      }
      const id = await sendMessage(formatted);
      if (id && !activeDialogueId) {
        setActiveDialogueId(id);
      }
      await loadDialogues();
    };
    reader.readAsText(file);
    e.target.value = '';
    setAttachMenuOpen(false);
  }, [alertDialog, sendMessage, activeDialogueId, setActiveDialogueId, loadDialogues, t]);

  return {
    docPickerOpen,
    setDocPickerOpen,
    attachMenuOpen,
    setAttachMenuOpen,
    pendingAttachments,
    setPendingAttachments,
    fileInputRef,
    attachMenuRef,
    removePendingAttachment,
    handlePasteAsNote,
    handleDocSelect,
    handleFileUpload,
  };
}
