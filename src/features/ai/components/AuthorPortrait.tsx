import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, Download } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { AIProfileService } from '../services/AIProfileService';
import { getLocalDb } from '../../../core/storage/localDb';
import { useToast } from '../../../shared/components/Toast';
import { reportError } from '../../../shared/errors/reportError';

interface AuthorPortraitProps {
  readOnly?: boolean;
}

export function AuthorPortrait({ readOnly = false }: AuthorPortraitProps = {}) {
  const { showToast } = useToast();
  const [portraitText, setPortraitText] = useState<string | null>(null);
  const [portraitGenerating, setPortraitGenerating] = useState(false);
  const [summariesCount, setSummariesCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const portrait = await AIProfileService.getPortrait();
      setPortraitText(portrait);

      const db = await getLocalDb();
      const summaries = await db.getAll('aiSummaries');
      setSummariesCount(summaries.length);
    } catch (e) {
      console.error('[AuthorPortrait] failed to load data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
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
        showToast('Психологический портрет обновлён', 'success');
        // Refresh summariesCount
        const db = await getLocalDb();
        const summaries = await db.getAll('aiSummaries');
        setSummariesCount(summaries.length);
      } else if (result.error === 'NOT_ENOUGH_DATA') {
        showToast('Нужно минимум 3 проанализированных заметки', 'error');
      } else if (result.error === 'DAILY_LIMIT') {
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
    const result = await AIProfileService.exportMarkdown();
    if (!result) showToast('Портрет ещё не создан', 'error');
  };

  if (loading) {
    return (
      <div className="rounded-2xl bg-surface-base/5 border border-border-subtle overflow-hidden p-8 flex justify-center items-center">
        <Loader2 size={16} className="animate-spin text-text-main/60" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-surface-base/5 border border-border-subtle overflow-hidden">
      <div className="px-5 py-3 border-b border-border-subtle flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-text-main/60 uppercase tracking-wider">Психологический портрет пользователя</span>
        {!readOnly && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              onClick={() => void handleGeneratePortrait()}
              disabled={portraitGenerating}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-brand-soft/20 bg-brand-soft/10 text-brand-soft text-[10px] font-bold disabled:opacity-50"
            >
              {portraitGenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {portraitGenerating ? 'Генерация…' : (portraitText ? 'Обновить' : 'Сгенерировать')}
            </Button>
            <Button
              onClick={() => void handleExportProfile()}
              disabled={!portraitText}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-border-subtle text-text-main/60 text-[10px] font-bold disabled:opacity-40"
            >
              <Download size={12} />
              Экспорт .md
            </Button>
          </div>
        )}
      </div>
      <div className="px-5 py-4 max-h-60 overflow-y-auto text-xs text-text-main/60 leading-relaxed">
        {portraitText ? (
          <MarkdownRenderer content={portraitText} />
        ) : readOnly && summariesCount < 20 ? (
          <span className="italic text-text-main/60">
            Портрет появится автоматически после ~20 проанализированных заметок (сейчас проанализировано: {summariesCount}/20).
          </span>
        ) : (
          <span className="italic text-text-main/60">
            Портрет ещё не создан — нажмите «Сгенерировать» (нужно ≥3 проанализированных заметок)
          </span>
        )}
      </div>
    </div>
  );
}
