import React, { useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Download, X, RotateCcw, Bug, Cpu, Database, ChevronRight, ChevronDown, Cloud, HardDrive } from 'lucide-react';
import { getLocalDb, getOrCreateGuestId, type LocalDocument, type LocalVersion } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { APP_VERSION } from '../../../version';
import { useDailyLimit } from '../../ai/hooks/useDailyLimit';
import { getAuth } from 'firebase/auth';
import { cn } from '../../../core/utils/utils';

type Tab = 'stats' | 'db' | 'ai';

interface DocWithVersions extends LocalDocument {
  versions: LocalVersion[];
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function DocRow({ doc }: { doc: DocWithVersions }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border-subtle overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-2 px-3 py-2.5 bg-surface-card hover:bg-text-main/5 transition-colors text-left"
      >
        {open ? <ChevronDown size={13} className="mt-0.5 shrink-0 text-text-main/40" /> : <ChevronRight size={13} className="mt-0.5 shrink-0 text-text-main/40" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-text-main truncate">{doc.title || '(без названия)'}</span>
            {doc.linkedCloudId && <Cloud size={10} className="shrink-0 text-brand-soft/70" aria-label="В облаке" />}
            {!doc.linkedCloudId && <HardDrive size={10} className="shrink-0 text-text-main/30" aria-label="Только локально" />}
            {doc.aiProcessed && <span className="text-[9px] px-1 rounded bg-brand-soft/15 text-brand-soft">AI</span>}
          </div>
          <div className="flex gap-3 mt-0.5">
            <span className="text-[10px] text-text-main/40">{doc.totalWords} сл.</span>
            <span className="text-[10px] text-text-main/40">{doc.sessionsCount} сессий</span>
            <span className="text-[10px] text-text-main/40">{formatDate(doc.lastSessionAt)}</span>
          </div>
          <div className="text-[9px] text-text-main/25 font-mono mt-0.5 truncate">{doc.id}</div>
        </div>
      </button>

      {open && (
        <div className="border-t border-border-subtle bg-surface-base/50">
          {doc.versions.length === 0 && (
            <div className="px-4 py-2 text-[10px] text-text-main/30">Версий нет</div>
          )}
          {doc.versions.map(v => (
            <div key={v.id} className="border-b border-border-subtle/50 last:border-0 px-4 py-2">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-[10px] font-mono text-text-main/40">v{v.version}</span>
                <span className="text-[10px] text-text-main/40">{v.wordCount} сл.</span>
                <span className="text-[10px] text-text-main/40">{Math.round(v.duration / 60)} мин</span>
                {v.wpm > 0 && <span className="text-[10px] text-text-main/40">{v.wpm} wpm</span>}
                {v.mood && <span className="text-[10px]">{v.mood}</span>}
                <span className="text-[10px] text-text-main/30 ml-auto">{formatDate(v.savedAt)}</span>
              </div>
              <div className="text-[10px] text-text-main/50 font-mono leading-relaxed bg-surface-base rounded px-2 py-1 max-h-20 overflow-y-auto">
                {v.content ? v.content.slice(0, 300) + (v.content.length > 300 ? '…' : '') : '(пусто)'}
              </div>
              <div className="text-[9px] text-text-main/20 font-mono mt-0.5 truncate">{v.id}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DiagnosticsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('stats');
  const [stats, setStats] = useState({ localDocs: 0, cloudDocs: 0, aiProcessed: 0, dialogues: 0, summaries: 0, customPersonas: 0 });
  const [docs, setDocs] = useState<DocWithVersions[]>([]);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [portraitText, setPortraitText] = useState<string | null>(null);
  const [summaryLogs, setSummaryLogs] = useState<{ id: string; title: string; processedAt: number; tone: string }[]>([]);
  const dailyLimit = useDailyLimit();

  const unlocked = localStorage.getItem('diagnostics_unlocked') === 'true';
  if (!unlocked) return <Navigate to="/" replace />;

  // eslint-disable-next-line react-hooks/rules-of-hooks -- guard above is stable
  useEffect(() => {
    (async () => {
      try {
        const uid = getAuth().currentUser?.uid ?? getOrCreateGuestId();
        const localDocs = await LocalDocumentService.getGuestDocuments(uid);
        const db = await getLocalDb();
        const dialogues = await db.getAll('aiDialogues');
        const summaries = await db.getAll('aiSummaries');
        const personas = await db.getAll('aiPersonas');
        setStats({
          localDocs: localDocs.length,
          cloudDocs: localDocs.filter(d => d.linkedCloudId).length,
          aiProcessed: localDocs.filter(d => d.aiProcessed).length,
          dialogues: dialogues.length,
          summaries: summaries.length,
          customPersonas: personas.length,
        });
        setLoaded(true);
      } catch { setLoaded(true); }
    })();
  }, []);

  // eslint-disable-next-line react-hooks/rules-of-hooks -- guard above is stable
  useEffect(() => {
    if (tab !== 'db' || dbLoaded) return;
    (async () => {
      try {
        const uid = getAuth().currentUser?.uid ?? getOrCreateGuestId();
        const localDocs = await LocalDocumentService.getGuestDocuments(uid);
        const db = await getLocalDb();
        const withVersions: DocWithVersions[] = await Promise.all(
          localDocs.map(async doc => {
            const versions = await db.getAllFromIndex('versions', 'by-document', doc.id);
            versions.sort((a, b) => b.version - a.version);
            return { ...doc, versions };
          })
        );
        withVersions.sort((a, b) => b.lastSessionAt - a.lastSessionAt);
        setDocs(withVersions);
        setDbLoaded(true);
      } catch { setDbLoaded(true); }
    })();
  }, [tab, dbLoaded]);

  // eslint-disable-next-line react-hooks/rules-of-hooks -- guard above is stable
  useEffect(() => {
    if (tab !== 'ai') return;
    (async () => {
      try {
        try {
          const { AIProfileService } = await import('../../ai/services/AIProfileService');
          const portrait = await AIProfileService.getPortrait();
          setPortraitText(portrait);
        } catch {
          const local = localStorage.getItem('ai_user_portrait');
          setPortraitText(local);
        }

        const db = await getLocalDb();
        const summaries = await db.getAll('aiSummaries');
        const uid = getAuth().currentUser?.uid ?? getOrCreateGuestId();
        const localDocs = await LocalDocumentService.getGuestDocuments(uid);

        const logs = summaries.map(s => {
          const doc = localDocs.find(d => d.id === s.documentId);
          return {
            id: s.documentId,
            title: doc?.title ?? '(без названия)',
            processedAt: s.processedAt,
            tone: s.tone,
          };
        });
        logs.sort((a, b) => b.processedAt - a.processedAt);
        setSummaryLogs(logs);
      } catch { /* ignore */ }
    })();
  }, [tab]);

  const handleExportProfile = async () => {
    const { AIProfileService } = await import('../../ai/services/AIProfileService');
    const result = await AIProfileService.exportMarkdown();
    if (!result) alert('Портрет ещё не создан');
  };

  const handleResetCounter = () => {
    localStorage.removeItem('ai_daily_usage');
    useAiLimitStore.setState({ used: 0, remaining: useAiLimitStore.getState().limit });
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'stats', label: 'Статистика', icon: <Bug size={12} /> },
    { id: 'db', label: 'База данных', icon: <Database size={12} /> },
    { id: 'ai', label: 'AI', icon: <Cpu size={12} /> },
  ];

  const statRows = [
    { label: 'Версия приложения', value: APP_VERSION },
    { label: 'Версия БД', value: '5' },
    { label: 'Локальные документы', value: stats.localDocs },
    { label: 'Синхронизировано с облаком', value: stats.cloudDocs },
    { label: 'Только локально', value: stats.localDocs - stats.cloudDocs },
  ];

  const aiRows = [
    { label: 'Обработано ИИ', value: stats.aiProcessed },
    { label: 'Диалогов с ИИ', value: stats.dialogues },
    { label: 'Саммари', value: stats.summaries },
    { label: 'Кастомных персон', value: stats.customPersonas },
    { label: 'Использование сегодня', value: `${dailyLimit.used} / ${dailyLimit.limit} запросов` },
  ];

  return (
    <div className="min-h-screen bg-surface-base p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-text-main flex items-center gap-2">
          <Bug size={16} className="text-text-main/50" />
          Диагностика
        </h2>
        <button onClick={() => navigate('/')} className="p-2 rounded-lg text-text-main/40 hover:text-text-main transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="flex gap-1 mb-4">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
              tab === t.id ? "bg-text-main/10 text-text-main" : "text-text-main/40 hover:text-text-main/60"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'stats' && (
        <div className="space-y-2">
          {!loaded && <div className="text-xs text-text-main/30 text-center py-4">Загрузка...</div>}
          {statRows.map(r => (
            <div key={r.label} className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-surface-card border border-border-subtle">
              <span className="text-xs text-text-main/50">{r.label}</span>
              <span className="text-xs font-mono text-text-main">{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'db' && (
        <div className="space-y-2">
          {!dbLoaded && <div className="text-xs text-text-main/30 text-center py-4">Загрузка данных...</div>}
          {dbLoaded && docs.length === 0 && (
            <div className="text-xs text-text-main/30 text-center py-4">Документов нет</div>
          )}
          {docs.map(doc => <DocRow key={doc.id} doc={doc} />)}
        </div>
      )}

      {tab === 'ai' && (
        <div className="space-y-2">
          {aiRows.map(r => (
            <div key={r.label} className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-surface-card border border-border-subtle">
              <span className="text-xs text-text-main/50">{r.label}</span>
              <span className="text-xs font-mono text-text-main">{r.value}</span>
            </div>
          ))}

          {portraitText !== null && (
            <div className="mt-4 rounded-xl bg-surface-card border border-border-subtle overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border-subtle">
                <span className="text-xs font-medium text-text-main/60">Психологический портрет пользователя</span>
              </div>
              <div className="px-4 py-3 max-h-60 overflow-y-auto text-xs text-text-main/50 whitespace-pre-wrap">
                {portraitText || <span className="italic text-text-main/25">Портрет ещё не создан</span>}
              </div>
            </div>
          )}

          {summaryLogs.length > 0 && (
            <div className="rounded-xl bg-surface-card border border-border-subtle overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border-subtle">
                <span className="text-xs font-medium text-text-main/60">История обработки заметок ИИ</span>
              </div>
              <div className="divide-y divide-border-subtle/50">
                {summaryLogs.map(log => (
                  <div key={log.id} className="px-4 py-2 flex items-center gap-3">
                    <span className="text-[10px] font-mono text-text-main/30">{formatDate(log.processedAt)}</span>
                    <span className="text-xs text-text-main/50 truncate flex-1">«{log.title}»</span>
                    <span className="text-[10px] text-brand-soft/60 shrink-0">{log.tone}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 space-y-2">
            <button
              onClick={handleExportProfile}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-soft/10 border border-brand-soft/20 text-brand-soft text-sm font-medium hover:bg-brand-soft/20 transition-colors"
            >
              <Download size={14} />
              Экспортировать профиль (.md)
            </button>
            <button
              onClick={handleResetCounter}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/20 transition-colors"
            >
              <RotateCcw size={14} />
              Сбросить счётчик ИИ
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => navigate('/')}
        className="mt-4 w-full px-4 py-2.5 rounded-xl border border-border-subtle text-text-main/50 text-sm font-medium hover:text-text-main/70 transition-colors"
      >
        Закрыть
      </button>
    </div>
  );
}
