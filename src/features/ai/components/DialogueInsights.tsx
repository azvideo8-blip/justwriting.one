// DI-6: «Выводы из разговоров» — что сохранено, вернуться в разговор, удалить.
// Состояние чтения — LoadState (сбой не «пусто», повтор обязателен), своего
// loading-useState нет. Обёртку секции даёт страница: на десктопе
// CollapsibleSection, на телефоне MeGroup. Пусто и флаг выключен — раздела нет
// вовсе; выводы есть — раздел остаётся и при выключенном флаге (их можно удалить).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { AIChatMemoryService } from '../services/AIChatMemoryService';
import { AIDialogueService } from '../services/AIDialogueService';
import type { AIChatMemory } from '../../../core/storage/localDb';
import { chatInsightsEnabled } from '../../../core/sync/syncFlags';
import { getCurrentUser, onAuthStateChange } from '../../../core/auth';
import { useLanguage } from '../../../shared/i18n';
import { getDateLocale } from '../../../core/utils/dateUtils';
import { useToast } from '../../../shared/components/Toast';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { Button } from '../../../shared/components/Button';
import { LoadStateView, LoadNotice } from '../../../shared/components/LoadStateView';
import { knownData, loadState, type LoadState } from '../../../shared/loadState';
import { reportError } from '../../../shared/errors/reportError';

export function DialogueInsights({ section }: { section: (content: ReactNode) => ReactNode }) {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState<AIChatMemory[]>>(loadState.loading());
  // Какие разговоры ещё живы — одним чтением списка при загрузке раздела.
  const [liveDialogueIds, setLiveDialogueIds] = useState<ReadonlySet<string>>(new Set());
  const [flagOn, setFlagOn] = useState<boolean | null>(null);
  // uid зеркала авторизации приходит асинхронно: на медленном старте раздел
  // монтируется раньше сессии, и разовый запрос флага навсегда остался бы false.
  const [uid, setUid] = useState<string | undefined>(() => getCurrentUser()?.uid);
  useEffect(() => onAuthStateChange(u => setUid(u?.uid)), []);

  const load = useCallback(async () => {
    const retry = () => { void load(); };
    setState(prev => loadState.loading(knownData(prev)));
    try {
      const conclusions = await AIChatMemoryService.getConclusions();
      const dialogues = await AIDialogueService.list({ includeArchived: true });
      setLiveDialogueIds(new Set(dialogues.map(d => d.id)));
      setState(loadState.settled(conclusions, c => c.length === 0));
    } catch (e: unknown) {
      reportError(e, { action: 'loadDialogueInsights' });
      setState(prev => loadState.error(retry, knownData(prev)));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    void chatInsightsEnabled(uid).then(on => { if (active) setFlagOn(on); });
    return () => { active = false; };
  }, [uid]);

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: t('ai_insight_delete_confirm_title'),
      message: t('ai_insight_delete_confirm_message'),
    });
    if (!ok) return;
    try {
      await AIChatMemoryService.delete(id);
    } catch (e: unknown) {
      // Строка остаётся на месте: удаление не подтверждено — не убираем.
      reportError(e, { action: 'insightDelete' });
      showToast(t('error_generic_action'), 'error');
      return;
    }
    setState(prev => {
      const data = knownData(prev);
      if (!data) return prev;
      const next = data.filter(m => m.id !== id);
      return loadState.settled(next, n => n.length === 0);
    });
  };

  // Первое чтение ещё идёт — секция не мигает заголовком; пусто или сбой чтения
  // при выключенном флаге (или ещё читается) — раздела нет вовсе: с флагом off
  // профиль как в 0.11.23 (ревью 0.11.24, Nit 1).
  if (state.status === 'loading' && state.stale === undefined) return null;
  if ((state.status === 'empty' || state.status === 'error') && flagOn !== true) return null;

  return section(
    <LoadStateView
      state={state}
      loading={<p className="text-sm text-text-main/50">{t('common_loading')}</p>}
      error={retry => <LoadNotice variant="panel" className="p-6" text={t('ai_insights_load_failed')} onRetry={retry} />}
      partial={retry => <LoadNotice variant="row" text={t('ai_insights_load_failed')} onRetry={retry} />}
      empty={<p className="text-sm text-text-main/60">{t('ai_insights_empty')}</p>}
    >
      {(items, notice) => (
        <div className="space-y-3">
          {notice}
          {items.map(m => (
            <div key={m.id} data-testid={`insight-row-${m.id}`} className="rounded-xl border border-border-subtle bg-surface-card p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px] text-text-main/50 font-mono">
                <span>{format(new Date(m.confirmedAt ?? m.createdAt), 'd MMM yyyy', { locale: getDateLocale(language) })}</span>
                <span>{m.confirmedBy === 'button' ? t('ai_insight_by_button') : t('ai_insight_by_reply')}</span>
              </div>
              <p className="text-sm text-text-main/90">«{m.text}»</p>
              <div className="flex flex-wrap gap-3">
                {liveDialogueIds.has(m.sourceDialogueId) && (
                  <Button
                    onClick={() => void navigate('/ai?dialogue=' + encodeURIComponent(m.sourceDialogueId))}
                    className="text-[12px] text-brand-soft underline hover:text-brand-soft/80"
                  >
                    {t('ai_insight_open_dialogue')}
                  </Button>
                )}
                <Button
                  onClick={() => { void handleDelete(m.id); }}
                  className="text-[12px] text-text-main/50 underline hover:text-accent-danger"
                >
                  {t('ai_insight_delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </LoadStateView>,
  );
}