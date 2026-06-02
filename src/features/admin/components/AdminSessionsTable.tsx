import React, { useState } from 'react';
import { format } from 'date-fns';
import { Trash2, Check, Eye, Loader2, Sparkles } from 'lucide-react';
import { parseFirestoreDate } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { IconButton } from '../../../shared/components/IconButton';

import { Session } from '../../../types';

interface AdminSessionsTableProps {
  sessions: Session[];
  onDelete: (id: string) => void;
  onProcess: (id: string, content: string) => Promise<void>;
  onRead: (text: string) => void;
}

export function AdminSessionsTable({ sessions, onDelete, onProcess, onRead }: AdminSessionsTableProps) {
  const { t } = useLanguage();
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleProcess = async (id: string, content: string) => {
    setProcessingId(id);
    try {
      await onProcess(id, content);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="border-b bg-surface-base/5 border-border-subtle">
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">{t('admin_col_title')}</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">{t('admin_col_author')}</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">{t('admin_col_date')}</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">AI</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">{t('admin_col_actions')}</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map(s => (
          <tr key={s.id} className="border-b last:border-0 border-border-subtle">
            <td className="px-6 py-4 text-sm font-medium text-text-main">{s.title || t('common_untitled')}</td>
             <td className="px-6 py-4 text-sm text-text-main/70">{s.userId?.slice(0, 8) || t('common_anonymous')}</td>
            <td className="px-6 py-4 text-sm text-text-main/50">
              {s.createdAt != null ? format(parseFirestoreDate(s.createdAt)!, 'dd.MM.yyyy HH:mm') : '-'}
            </td>
            <td className="px-6 py-4">
              {s._aiProcessed ? (
                <div className="flex items-center gap-1.5">
                  <Check size={14} className="text-emerald-500" />
                  <span className="text-[10px] text-text-main/40">{s._aiAction}</span>
                  <button
                    onClick={() => onRead(s._aiResultText ?? '')}
                    className="p-1 rounded text-text-main/40 hover:text-text-main transition-colors"
                    title="Прочитать"
                  >
                    <Eye size={14} />
                  </button>
                </div>
              ) : processingId === s.id ? (
                <Loader2 size={14} className="animate-spin text-brand-soft/50" />
              ) : (
                <button
                  onClick={() => void handleProcess(s.id, s.content)}
                  className="p-1 rounded text-text-main/30 hover:text-brand-soft transition-colors"
                  title="Обработать"
                >
                  <Sparkles size={14} />
                </button>
              )}
            </td>
            <td className="px-6 py-4">
              <IconButton
                onClick={() => onDelete(s.id)}
                className="p-3 transition-colors text-text-main/40 hover:text-accent-danger"
                label="Delete session"
                icon={<Trash2 size={18} />}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
