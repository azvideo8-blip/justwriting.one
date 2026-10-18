import { useState } from 'react';
import { ModalShell, SheetTitle } from '../../../shared/components/ModalShell';
import { useLanguage } from '../../../shared/i18n';

// MF-5: один лист перед записью на телефоне вместо двух предупреждений (окно
// «куда уходит голос» и строка «стоит запрос» в карточке записи). С сейфом —
// текст сейфа и без «Больше не показывать»: это предупреждение безопасности.
export interface VoiceNotice {
  vault: boolean;
  /** Сколько запросов останется, если запись пойдёт через ИИ; null — не пойдёт. */
  remaining: number | null;
}

export function MobileVoiceNoticeSheet({ open = true, notice, onCancel, onRecord }: {
  /** MQ-5: родитель держит лист смонтированным ещё на время ухода, пока `open` уже false. */
  open?: boolean;
  notice: VoiceNotice;
  onCancel: () => void;
  /** Вызывается прямо из обработчика нажатия: без await до старта записи (iOS). */
  onRecord: (dismiss: boolean) => void;
}) {
  const { t } = useLanguage();
  const [dismiss, setDismiss] = useState(false);
  return (
    <ModalShell open={open} onClose={onCancel} labelId="voice-notice-title" variant="sheet">
      <div className="px-6 pt-6 pb-4 space-y-4" data-voice-notice>
        <SheetTitle id="voice-notice-title">{t('voice_confirm_title')}</SheetTitle>
        {notice.vault ? (
          <p className="text-sm text-text-main/80 leading-relaxed">{t('voice_confirm_vault_desc')}</p>
        ) : (
          <ul className="space-y-2 text-sm text-text-main/80 leading-relaxed">
            <li>{t('voice_sheet_where_audio')}</li>
            <li>{t('voice_sheet_where_text')}</li>
          </ul>
        )}
        {notice.remaining !== null && !notice.vault && (
          <p className="text-sm text-text-main/80" data-voice-cost>{t('voice_sheet_cost', { remaining: notice.remaining })}</p>
        )}
        {!notice.vault && (
          <label className="flex min-h-11 items-center gap-3 text-sm text-text-main">
            <input type="checkbox" className="h-5 w-5" checked={dismiss} onChange={e => setDismiss(e.target.checked)} />
            {t('voice_sheet_dont_show')}
          </label>
        )}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onCancel} className="press min-h-11 flex-1 rounded-2xl border border-[var(--border-light)] text-sm font-semibold text-text-main">
            {t('common_cancel')}
          </button>
          <button type="button" onClick={() => onRecord(dismiss && !notice.vault)} className="press min-h-11 flex-1 rounded-2xl text-sm font-semibold" style={{ background: 'var(--text-main)', color: 'var(--bg-base)' }}>
            {t('voice_sheet_record')}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
