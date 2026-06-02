import { useState } from 'react';
import { X } from 'lucide-react';
import { countWords } from '../../../shared/utils/countWords';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { Session } from '../../../types';
import { useLanguage } from '../../../shared/i18n';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { reportError } from '../../../shared/errors/reportError';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';

interface SessionEditorProps {
  session: Session;
  onCancel: () => void;
  onSave: () => void;
}

export function SessionEditor({ session, onCancel, onSave }: SessionEditorProps) {
  const { t } = useLanguage();
  const { execute } = useServiceAction();
  const [editContent, setEditContent] = useState(session.content);
  const [editTitle, setEditTitle] = useState(session.title || '');
  const [editTags, setEditTags] = useState<string[]>(session.tags || []);
  const [tagInput, setTagInput] = useState('');

  const handleSave = () => {
    const wordCount = countWords(editContent);

    void execute(
      async () => {
        const docId = session.id;
        if (session._isLocal) {
          await LocalVersionService.addVersion(session.userId, docId, {
            content: editContent,
            previousContent: session.content,
            wordCount,
            duration: session.duration,
            wpm: session.wpm,
            versionNumber: (await LocalDocumentService.getDocument(docId))?.currentVersion ?? 1,
            sessionStartedAt: new Date(),
          });
          await LocalDocumentService.updateAfterSession(docId, {
            totalWords: wordCount,
            totalDuration: session.duration,
            currentVersion: (await LocalDocumentService.getDocument(docId))?.currentVersion ?? 1,
          });
          if (editTitle !== (session.title || '')) {
            await LocalDocumentService.updateTitle(docId, editTitle);
          }
          await LocalDocumentService.updateTags(docId, editTags);
        } else if (!session._isLocal) {
          reportError(new Error('SessionEditor: cloud tag update not yet supported'), { action: 'SessionEditor_cloudSave', sessionId: session.id }, 'warning');
        }
      },
      { successMessage: t('save_success'), errorMessage: t('error_save_failed'), onSuccess: onSave }
    );
  };

  const addTag = () => {
    if (tagInput.trim() && !editTags.includes(tagInput.trim())) {
      setEditTags([...editTags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const removeTag = (t: string) => {
    setEditTags(editTags.filter(tag => tag !== t));
  };

  return (
    <div className="space-y-4">
      <input 
        type="text"
        value={editTitle}
        onChange={(e) => setEditTitle(e.target.value)}
        placeholder={t('editor_title_placeholder')}
        className="w-full px-4 py-2 bg-surface-base rounded-2xl border border-border-subtle outline-none focus:border-text-main/40 transition-colors text-text-main font-bold"
      />
      <textarea 
        value={editContent}
        onChange={(e) => setEditContent(e.target.value)}
        className="w-full min-h-[200px] p-4 bg-surface-base rounded-2xl border border-border-subtle outline-none focus:border-text-main/40 transition-colors text-text-main"
      />
      <div className="flex flex-wrap items-center gap-2 p-3 bg-surface-base rounded-2xl border border-border-subtle">
        <div className="flex flex-wrap gap-2">
          {editTags.map(tag => (
            <span key={tag} className="flex items-center gap-1 px-2 py-1 bg-surface-card text-text-main/60 rounded-lg text-xs font-medium border border-border-subtle">
              #{tag}
              <IconButton icon={<X size={10} />} label={t('session_remove_tag')} size="sm" onClick={() => removeTag(tag)} className="hover:text-accent-danger" />
            </span>
          ))}
        </div>
        <input
          type="text"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTag()}
          placeholder={t('session_tag_placeholder')}
          className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm text-text-main"
        />
      </div>
      <div className="flex items-center justify-end">
        <div className="flex gap-2">
          <Button variant="ghost" size="md" onClick={onCancel} className="px-4 py-2 text-text-main/50 hover:text-text-main font-medium">{t('common_cancel')}</Button>
          <Button variant="primary" size="md" onClick={handleSave} className="px-6 py-2 rounded-2xl font-bold">{t('common_save')}</Button>
        </div>
      </div>
    </div>
  );
}
