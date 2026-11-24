import { useState, useRef } from 'react';
import { X, Search } from 'lucide-react';
import pLimit from 'p-limit';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { getOrCreateGuestId } from '../../../core/storage/localDb';
import { useLanguage } from '../../../shared/i18n';
import { getCurrentUser } from '../../../core/auth';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { ModalShell } from '../../../shared/components/ModalShell';
import { Input } from '../../../shared/components/Input';
import { reportError } from '../../../shared/errors/reportError';
import { isExcludedFromAI } from '../utils/isExcludedFromAI';

interface DocumentPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (documentId: string) => void;
}

interface DocEntry {
  id: string;
  title: string;
  lastSessionAt: number;
  preview: string;
  mood?: string | undefined;
}

export function DocumentPickerModal({ isOpen, onClose, onSelect }: DocumentPickerModalProps) {
  const { t } = useLanguage();
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  if (!loaded) {
    setLoaded(true);
    void (async () => {
      try {
        const guestId = getCurrentUser()?.uid ?? getOrCreateGuestId();
        const allDocs = (await LocalDocumentService.getDocumentsByOwner(guestId)).filter(d => !isExcludedFromAI(d));
        allDocs.sort((a, b) => b.lastSessionAt - a.lastSessionAt);
        const limit = pLimit(10);
        const entries: DocEntry[] = await Promise.all(
          allDocs.map(doc =>
            limit(async () => {
              const preview = await LocalVersionService.getLatestPreview(doc.id, 100, guestId);
              return {
                id: doc.id,
                title: doc.title || t('common_untitled'),
                lastSessionAt: doc.lastSessionAt,
                preview,
                mood: doc.mood,
              };
            })
          )
        );
        setDocs(entries);
      } catch (e) {
        reportError(e, { action: 'documentPicker_load' });
        setFailed(true);
      }
    })();
  }

  const filtered = (search
    ? docs.filter(d => d.title.toLowerCase().includes(search.toLowerCase()))
    : docs
  ).slice(0, 100);

  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      labelId="doc-picker-title"
      className="bg-surface-card border border-border-subtle rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
        <h3 id="doc-picker-title" className="text-sm font-bold text-text-main">{t('ai_doc_picker_title')}</h3>
          <IconButton onClick={onClose} className="p-1.5 rounded-lg text-text-main/60 hover:text-text-main transition-colors" label={t('close')} icon={<X size={18} />} />
        </div>

        <div className="px-4 py-3 border-b border-border-subtle">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-main/60" />
            <Input
              ref={inputRef}
              aria-label={t('ai_doc_picker_search_placeholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('ai_doc_picker_search_placeholder')}
              className="pl-9 pr-3 py-2 rounded-xl bg-text-main/5 border border-border-subtle text-sm text-text-main placeholder:text-text-main/40 outline-none focus:border-brand-soft/40"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filtered.map(doc => (
            <Button
              key={doc.id}
              onClick={() => { onSelect(doc.id); onClose(); }}
              className="w-full text-left px-4 py-3 rounded-xl hover:bg-text-main/5 transition-colors group"
            >
              <div className="flex items-center gap-2">
                {doc.mood && <span className="text-lg">{doc.mood}</span>}
                <span className="text-sm font-medium text-text-main truncate">{doc.title}</span>
              </div>
              <p className="text-xs text-text-main/60 mt-1 line-clamp-2">{doc.preview}</p>
            </Button>
          ))}
          {failed ? (
            <Button onClick={() => { setFailed(false); setLoaded(false); }} className="w-full py-8 text-center text-sm text-accent-warning">{t('load_failed_retry')}</Button>
          ) : filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-text-main/60">{t('ai_doc_picker_empty')}</div>
          )}
        </div>
    </ModalShell>
  );
}
