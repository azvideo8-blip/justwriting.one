import { useState } from 'react';
import { ModalShell } from '../../../shared/components/ModalShell';
import { Button } from '../../../shared/components/Button';
import { useLanguage } from '../../../shared/i18n';

/** MF-11: один лист переименования на всех входах телефона — читалка, строка
 *  списка, карточка сетки. Сохранение идёт тем же onTitleChange, что на десктопе. */
export function MobileRenameSheet({ initialTitle, onCancel, onSave }: {
  initialTitle: string;
  onCancel: () => void;
  onSave: (title: string) => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(initialTitle);
  const save = () => {
    const title = draft.trim();
    if (title) onSave(title);
  };
  return (
    <ModalShell open onClose={onCancel} labelId="note-rename-title" variant="sheet">
      <div className="p-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)]">
        <h2 id="note-rename-title" className="text-[17px] font-semibold text-text-main">{t('archive_rename_title')}</h2>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          aria-label={t('archive_rename_title')}
          className="mt-4 min-h-12 w-full rounded-xl border border-border-subtle bg-transparent px-3 text-[17px] text-text-main outline-none"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onCancel} className="min-h-11 px-4 text-[15px] text-text-main/60">{t('common_cancel')}</Button>
          <Button onClick={save} disabled={!draft.trim()} className="min-h-11 rounded-xl px-4 text-[15px] font-medium text-text-main disabled:opacity-40">{t('common_save')}</Button>
        </div>
      </div>
    </ModalShell>
  );
}
