import { useState } from 'react';
import { ModalShell, SheetTitle } from '../../../shared/components/ModalShell';
import { Button } from '../../../shared/components/Button';
import { Input } from '../../../shared/components/Input';
import { useLanguage } from '../../../shared/i18n';
import { useExitLinger } from '../../../shared/hooks/useExitLinger';

/** MF-11: один лист переименования на всех входах телефона — читалка, строка
 *  списка, карточка сетки. Сохранение идёт тем же onTitleChange, что на десктопе. */
export function MobileRenameSheet({ open = true, ...rest }: RenameSheetProps) {
  // MQ-5: смонтирован всегда, тело живёт ещё 250 мс после закрытия — лист уходит вниз.
  return useExitLinger(open) ? <RenameSheetBody open={open} {...rest} /> : null;
}

interface RenameSheetProps {
  open?: boolean;
  initialTitle: string;
  onCancel: () => void;
  onSave: (title: string) => void;
}

function RenameSheetBody({ open = true, initialTitle, onCancel, onSave }: RenameSheetProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(initialTitle);
  const save = () => {
    const title = draft.trim();
    if (title) onSave(title);
  };
  return (
    <ModalShell open={open} onClose={onCancel} labelId="note-rename-title" variant="sheet">
      <div className="p-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)]">
        <SheetTitle id="note-rename-title">{t('archive_rename_title')}</SheetTitle>
        <Input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          aria-label={t('archive_rename_title')}
          className="mt-4 min-h-12 bg-transparent text-[16px]"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onCancel} className="min-h-11 px-4 text-[15px] text-text-main/60">{t('common_cancel')}</Button>
          {/* U-6 (решение владельца 2026-10-18): главное действие — primary-инверсия, как «Сохранить» на десктопе. */}
          <Button variant="primary" onClick={save} disabled={!draft.trim()} className="min-h-11 rounded-xl px-4 text-[15px] font-medium">{t('common_save')}</Button>
        </div>
      </div>
    </ModalShell>
  );
}
