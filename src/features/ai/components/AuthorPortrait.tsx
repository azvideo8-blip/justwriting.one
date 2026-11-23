import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, Download, Sparkles } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { AIProfileService } from '../services/AIProfileService';
import { getLocalDb } from '../../../core/storage/localDb';
import { useToast } from '../../../shared/components/Toast';
import { reportError } from '../../../shared/errors/reportError';
import { isDayLimitError } from '../types/aiErrors';
import { useLanguage } from '../../../shared/i18n';
import { LoadNotice } from '../../../shared/components/LoadStateView';

interface AuthorPortraitProps {
  readOnly?: boolean;
}

export function AuthorPortrait({ readOnly = false }: AuthorPortraitProps = {}) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [portraitText, setPortraitText] = useState<string | null>(null);
  const [portraitGenerating, setPortraitGenerating] = useState(false);
  const [summariesCount, setSummariesCount] = useState(0);
  // PX-3: портрет собран по прежним правилам. Флаг читается из локальной записи:
  // при открытии Профила к ИИ не обращаются, пересборка — только по нажатию.
  const [stalePortrait, setStalePortrait] = useState(false);
  // Не прочиталось ≠ «портрет не создан»: сбой чтения назван и перечитывается.
  const [read, setRead] = useState<'loading' | 'error' | 'done'>('loading');

  const loadData = async () => {
    setRead('loading');
    try {
      const portrait = await AIProfileService.getPortrait();
      setPortraitText(portrait);
      setStalePortrait(!!portrait && await AIProfileService.isPortraitStale());

      const db = await getLocalDb();
      const summaries = await db.getAll('aiSummaries');
      setSummariesCount(summaries.length);
      setRead('done');
    } catch (e) {
      reportError(e, { action: 'author_portrait_load' });
      setRead('error');
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetching from IndexedDB on mount
    void loadData();
  }, []);

  const handleGeneratePortrait = async () => {
    if (!navigator.onLine) {
      showToast('Данная функция работает только при подключении к сети', 'error');
      return;
    }
    setPortraitGenerating(true);
    try {
      const result = await AIProfileService.generate();
      if (result.ok) {
        setPortraitText(result.markdown);
        // Строка «собран по прежним правилам» — по сохранённой версии: пересборка,
        // взявшая раздел из старого кэша, её оставляет (ревью 0.9.39).
        // Портрет уже собран: отказ чтения версии — не провал сборки (NB-12, ревью 0.11.24).
        setStalePortrait(await AIProfileService.isPortraitStale().catch(() => false));
        if (result.partial) showToast(t('ai_portrait_partial'), 'warning');
        else showToast('Психологический портрет обновлён', 'success');
        // Refresh summariesCount
        const db = await getLocalDb();
        const summaries = await db.getAll('aiSummaries');
        setSummariesCount(summaries.length);
      } else if (result.error === 'NOT_ENOUGH_DATA') {
        showToast('Нужно минимум 3 проанализированных заметки', 'error');
      } else if (isDayLimitError(result.error)) {
        showToast('Достигнут дневной лимит ИИ — сбросьте счётчик и попробуйте снова', 'error');
      } else {
        showToast(`Не удалось создать портрет: ${result.error}`, 'error');
      }
    } catch (e) {
      reportError(e, { action: 'Failed to generate portrait' });
      showToast('Ошибка при создании портрета', 'error');
    } finally {
      setPortraitGenerating(false);
    }
  };

  const handleExportProfile = async () => {
    try {
      const result = await AIProfileService.exportMarkdown();
      if (!result) showToast(t('ai_portrait_not_created_short'), 'error');
    } catch (e) {
      reportError(e, { action: 'authorPortrait_exportProfile' });
      showToast(t('archive_export_failed'), 'error');
    }
  };

  if (read === 'loading') {
    return (
      <div className="rounded-2xl bg-surface-base/5 border border-border-subtle overflow-hidden p-8 flex justify-center items-center">
        <Loader2 size={16} className="animate-spin text-text-main/60" />
      </div>
    );
  }
  if (read === 'error') {
    return <LoadNotice variant="panel" className="p-6" text={`${t('ai_portrait_title')}: ${t('load_failed_retry')}`} onRetry={() => void loadData()} />;
  }

  return (
    <div className="rounded-2xl bg-surface-base/5 border border-border-subtle overflow-hidden">
      <div className="px-5 py-3 border-b border-border-subtle flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-text-main/60 uppercase tracking-wider flex items-center gap-2">
          {t('ai_portrait_title')}
          <span className="inline-flex items-center gap-1 normal-case tracking-normal text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-brand-soft/10 text-brand-soft/80 border border-brand-soft/20">
            <Sparkles size={9} /> {t('ai_generated_tag')}
          </span>
        </span>
        {!readOnly && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              onClick={() => void handleGeneratePortrait()}
              disabled={portraitGenerating}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-brand-soft/20 bg-brand-soft/10 text-brand-soft text-[10px] font-bold disabled:opacity-50"
            >
              {portraitGenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {portraitGenerating ? t('ai_portrait_generating') : (portraitText ? t('ai_portrait_refresh') : t('ai_portrait_generate'))}
            </Button>
            <Button
              onClick={() => void handleExportProfile()}
              disabled={!portraitText}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-border-subtle text-text-main/60 text-[10px] font-bold disabled:opacity-40"
            >
              <Download size={12} />
              {t('ai_portrait_export_md')}
            </Button>
          </div>
        )}
      </div>
      {portraitText && stalePortrait && (
        <p className="px-5 pt-3 text-[11px] leading-snug text-text-main/40">
          {t('ai_portrait_stale_rules')}
        </p>
      )}
      <div className="px-5 py-4 max-h-60 overflow-y-auto text-xs text-text-main/60 leading-relaxed">
        {portraitText ? (
          <MarkdownRenderer content={portraitText} />
        ) : readOnly && summariesCount < 20 ? (
          <span className="italic text-text-main/60">
            {t('ai_portrait_auto_pending', { count: String(summariesCount) })}
          </span>
        ) : (
          <span className="italic text-text-main/60">
            {t('ai_portrait_not_created')}
          </span>
        )}
      </div>
    </div>
  );
}
