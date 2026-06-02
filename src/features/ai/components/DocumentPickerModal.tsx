import { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Search } from 'lucide-react';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { getLocalDb, getOrCreateGuestId } from '../../../core/storage/localDb';
import { useLanguage } from '../../../shared/i18n';
import { getAuth } from 'firebase/auth';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';

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
  const inputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  if (!loaded) {
    setLoaded(true);
    void (async () => {
      try {
        const guestId = getAuth().currentUser?.uid ?? getOrCreateGuestId();
        const allDocs = await LocalDocumentService.getGuestDocuments(guestId);
        const db = await getLocalDb();
        const entries: DocEntry[] = [];
        for (const doc of allDocs.slice(0, 20)) {
          const versions = await db.getAllFromIndex('versions', 'by-document', doc.id);
          const latest = versions.sort((a, b) => b.version - a.version)[0];
          entries.push({
            id: doc.id,
            title: doc.title || t('common_untitled'),
            lastSessionAt: doc.lastSessionAt,
            preview: latest?.content?.slice(0, 100) ?? '',
            mood: doc.mood,
          });
        }
        entries.sort((a, b) => b.lastSessionAt - a.lastSessionAt);
        setDocs(entries);
      } catch { /* ignore */ }
    })();
  }

  const filtered = search
    ? docs.filter(d => d.title.toLowerCase().includes(search.toLowerCase()))
    : docs;

  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative z-10 w-full max-w-md bg-surface-card border border-border-subtle rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h3 className="text-sm font-bold text-text-main">Какую заметку разберём?</h3>
          <IconButton onClick={onClose} className="p-1.5 rounded-lg text-text-main/40 hover:text-text-main transition-colors" label={t('close')} icon={<X size={18} />} />
        </div>

        <div className="px-4 py-3 border-b border-border-subtle">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-main/30" />
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по названию..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-text-main/5 border border-border-subtle text-sm text-text-main placeholder:text-text-main/30 outline-none focus:border-brand-soft/40"
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
              <p className="text-xs text-text-main/40 mt-1 line-clamp-2">{doc.preview}</p>
            </Button>
          ))}
          {filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-text-main/30">Ничего не найдено</div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
