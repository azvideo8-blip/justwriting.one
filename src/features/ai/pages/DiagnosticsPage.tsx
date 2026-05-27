import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Download, X, RotateCcw, Bug, Cpu } from 'lucide-react';
import { getLocalDb, getOrCreateGuestId } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { APP_VERSION } from '../../../version';
import { useDailyLimit } from '../../ai/hooks/useDailyLimit';
import { getAuth } from 'firebase/auth';
import { cn } from '../../../core/utils/utils';

export function DiagnosticsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'stats' | 'ai'>('stats');
  const [stats, setStats] = useState({
    localDocs: 0,
    cloudDocs: 0,
    aiProcessed: 0,
    dialogues: 0,
    summaries: 0,
    customPersonas: 0,
  });
  const [loaded, setLoaded] = useState(false);

  const dailyLimit = useDailyLimit();

  const unlocked = localStorage.getItem('diagnostics_unlocked') === 'true';
  if (!unlocked) return <Navigate to="/" replace />;

  if (!loaded) {
    setLoaded(true);
    (async () => {
      try {
        const guestId = getAuth().currentUser?.uid ?? getOrCreateGuestId();
        const docs = await LocalDocumentService.getGuestDocuments(guestId);
        const db = await getLocalDb();
        const dialogues = await db.getAll('aiDialogues');
        const summaries = await db.getAll('aiSummaries');
        const personas = await db.getAll('aiPersonas');

        setStats({
          localDocs: docs.length,
          cloudDocs: docs.filter(d => d.linkedCloudId).length,
          aiProcessed: docs.filter(d => d.aiProcessed).length,
          dialogues: dialogues.length,
          summaries: summaries.length,
          customPersonas: personas.length,
        });
      } catch { /* ignore */ }
    })();
  }

  const handleExportProfile = async () => {
    const { AIProfileService } = await import('../../ai/services/AIProfileService');
    const result = await AIProfileService.exportMarkdown();
    if (!result) return;
  };

  const handleResetCounter = () => {
    localStorage.removeItem('ai_daily_usage');
    useAiLimitStore.setState({ used: 0, remaining: useAiLimitStore.getState().limit });
  };

  const isDev = import.meta.env.DEV;

  const statRows = [
    { label: 'Локальные документы', value: stats.localDocs },
    { label: 'В облаке', value: stats.cloudDocs },
    { label: 'Версия БД', value: '5' },
    { label: 'Версия приложения', value: APP_VERSION },
  ];

  const aiRows = [
    { label: 'Обработано ИИ', value: stats.aiProcessed },
    { label: 'Диалогов с ИИ', value: stats.dialogues },
    { label: 'Саммари', value: stats.summaries },
    { label: 'Кастомных персон', value: stats.customPersonas },
    { label: 'Использование сегодня', value: `${dailyLimit.used} / ${dailyLimit.limit} запросов` },
  ];

  return (
    <div className="min-h-screen bg-surface-base p-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-text-main flex items-center gap-2">
          <Bug size={18} className="text-text-main/50" />
          Диагностика
        </h2>
        <button onClick={() => navigate('/')} className="p-2 rounded-lg text-text-main/40 hover:text-text-main transition-colors">
          <X size={18} />
        </button>
      </div>

      <div className="flex gap-1 mb-4">
        <button
          onClick={() => setTab('stats')}
          className={cn(
            "flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
            tab === 'stats' ? "bg-text-main/10 text-text-main" : "text-text-main/40 hover:text-text-main/60"
          )}
        >
          <Bug size={12} />
          Статистика
        </button>
        <button
          onClick={() => setTab('ai')}
          className={cn(
            "flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
            tab === 'ai' ? "bg-text-main/10 text-text-main" : "text-text-main/40 hover:text-text-main/60"
          )}
        >
          <Cpu size={12} />
          AI
        </button>
      </div>

      <div className="space-y-2">
        {(tab === 'stats' ? statRows : aiRows).map(r => (
          <div key={r.label} className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-surface-card border border-border-subtle">
            <span className="text-xs text-text-main/50">{r.label}</span>
            <span className="text-xs font-mono text-text-main">{r.value}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-2">
        {tab === 'ai' && (
          <button
            onClick={handleExportProfile}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-soft/10 border border-brand-soft/20 text-brand-soft text-sm font-medium hover:bg-brand-soft/20 transition-colors"
          >
            <Download size={14} />
            Экспортировать профиль (.md)
          </button>
        )}

        {isDev && tab === 'ai' && (
          <button
            onClick={handleResetCounter}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/20 transition-colors"
          >
            <RotateCcw size={14} />
            Сбросить счётчик ИИ
          </button>
        )}

        <button
          onClick={() => navigate('/')}
          className="w-full px-4 py-2.5 rounded-xl border border-border-subtle text-text-main/50 text-sm font-medium hover:text-text-main/70 transition-colors"
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}
