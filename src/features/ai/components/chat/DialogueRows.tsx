import type { ReactNode } from 'react';
import type { AIDialogue } from '../../../../core/storage/localDb';
import { useLanguage } from '../../../../shared/i18n';
import { LoadStateView, LoadNotice } from '../../../../shared/components/LoadStateView';
import type { LoadState } from '../../../../shared/loadState';

interface DialogueRowsProps {
  /** Строки выбранной вкладки (активные или архив) — уже отфильтрованные. */
  state: LoadState<AIDialogue[]>;
  showArchived: boolean;
  noticeClassName: string;
  children: (rows: AIDialogue[]) => ReactNode;
}

/**
 * Состояния списка диалогов — одни на десктопную колонку и телефонный лист:
 * загрузка, сбой чтения с «Повторить», «нет активных» / «нет архивных».
 * Раньше обе ветки жили копиями в двух компонентах и расходились (дейлик 19.11 Н-4).
 */
export function DialogueRows({ state, showArchived, noticeClassName, children }: DialogueRowsProps) {
  const { t } = useLanguage();
  const hint = (text: string) => <div className="py-8 text-center text-xs text-text-main/60">{text}</div>;
  return (
    <LoadStateView
      state={state}
      loading={hint(t('common_loading'))}
      error={retry => <LoadNotice variant="row" className={noticeClassName} text={t('ai_dialogues_load_error')} onRetry={retry} />}
      // Диалоги читаются только с устройства: частичного отказа облака у этого чтения нет.
      partial={() => null}
      empty={hint(t(showArchived ? 'ai_no_archived_dialogues' : 'ai_no_active_dialogues'))}
    >
      {(rows, notice) => <>{children(rows)}{notice}</>}
    </LoadStateView>
  );
}
