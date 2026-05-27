import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import { AdminUserService } from '../services/AdminUserService';
import { AdminSessionService } from '../services/AdminSessionService';
import { auth } from '../../../core/firebase/auth';
import { Users, Database, Shield, AlertTriangle, Download, Loader, RefreshCw, Sparkles, X } from 'lucide-react';
import { AdminUsersTable } from '../components/AdminUsersTable';
import { AdminSessionsTable } from '../components/AdminSessionsTable';
import { useLanguage } from '../../../core/i18n';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { useToast } from '../../../shared/components/Toast';
import { cn } from '../../../core/utils/utils';
import { reportError } from '../../../core/errors/reportError';
import { AIService } from '../../ai/services/AIService';

import { Session, UserProfile } from '../../../types';
import { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { CancelConfirmModal } from '../../../shared/components/CancelConfirmModal';
import { LoadingSpinner } from '../../../shared/components/LoadingSpinner';
import { StorageService } from '../../../core/services/StorageService';
import { SyncDiagnostics } from '../../settings/components/SyncDiagnostics';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getLocalDb } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { DocumentService } from '../../../core/services/DocumentService';
import { loadAllSessions as _loadAllSessions } from '../../writing/services/UnifiedSessionLoader';
import { maybeDecrypt } from '../../../core/crypto/cryptoHelpers';
import { toDate } from '../../../core/utils/dateUtils';
import { SessionService } from '../../../core/services/SessionService';
import { VersionService } from '../../writing/services/VersionService';

interface AIUsageRow {
  uid: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
}

export function AdminPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const lastSessionDocRef = useRef<QueryDocumentSnapshot<DocumentData, DocumentData> | null>(null);
  const [hasMoreSessions, setHasMoreSessions] = useState(true);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'sessions' | 'security' | 'diagnostics' | 'ai'>('users');
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ total: number; imported: number; failed: number } | null>(null);
  const [aiUsage, setAiUsage] = useState<AIUsageRow[]>([]);
  const [aiUsageDate, setAiUsageDate] = useState(new Date().toISOString().slice(0, 10));
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  const [aiSearchQuery, setAiSearchQuery] = useState('');
  const [, setProcessingId] = useState<string | null>(null);
  const [readText, setReadText] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const { t } = useLanguage();
  const { execute } = useServiceAction();
  const { showToast } = useToast();

  const fetchData = useCallback(async (isInitial = true) => {
    if (activeTab !== 'users' && activeTab !== 'sessions') {
      setLoading(false);
      return;
    }
    if (isInitial) {
      setLoading(true);
      lastSessionDocRef.current = null;
    } else {
      setLoadingMoreSessions(true);
    }
    
    try {
      if (activeTab === 'users') {
        const usersData = await AdminUserService.getUsers(50);
        setUsers(usersData);
      } else if (activeTab === 'sessions') {
        const db = await getLocalDb();
        const localDocs = await db.getAll('documents');
        const mappedLocal = await Promise.all(localDocs.map(async (doc) => {
          let content = '';
          try {
            const versions = await db.getAllFromIndex('versions', 'by-document', doc.id);
            if (versions.length > 0) {
              versions.sort((a, b) => b.version - a.version);
              const latestVer = versions[0];
              const decrypted = await maybeDecrypt(latestVer as unknown as Record<string, unknown>, ['content'], []);
              content = decrypted.content as string;
            }
          } catch (e) {
            console.error('Error loading content for local doc:', doc.id, e);
          }
          return {
            id: doc.id,
            userId: doc.guestId,
            content,
            duration: doc.totalDuration,
            wordCount: doc.totalWords,
            charCount: 0,
            wpm: 0,
            title: doc.title,
            tags: doc.tags,
            createdAt: toDate(doc.lastSessionAt) ?? new Date(),
            sessionStartTime: doc.lastSessionAt,
            _isLocal: true,
            _linkedCloudId: doc.linkedCloudId || undefined,
            _hasCloudCopy: !!doc.linkedCloudId,
            _isLegacy: false,
          } as Session;
        }));

        const cloudDocs = await DocumentService.getUserDocuments(auth.currentUser!.uid).catch(() => []);
        const localByCloudId = new Set(localDocs.filter(d => d.linkedCloudId).map(d => d.linkedCloudId!));
        const mappedCloud = await Promise.all(
          cloudDocs
            .filter(cd => !localByCloudId.has(cd.id))
            .map(async (cd) => {
              let content = '';
              try {
                const versions = await VersionService.getVersions(auth.currentUser!.uid, cd.id);
                if (versions.length > 0) {
                  const latestVer = versions[versions.length - 1];
                  const decrypted = await maybeDecrypt(latestVer as unknown as Record<string, unknown>, ['content'], []);
                  content = decrypted.content as string;
                }
              } catch (e) {
                console.error('Error loading content for cloud doc:', cd.id, e);
              }
              return {
                id: cd.id,
                userId: auth.currentUser!.uid,
                content,
                duration: cd.totalDuration,
                wordCount: cd.totalWords,
                charCount: 0,
                wpm: 0,
                title: cd.title,
                tags: cd.tags,
                createdAt: toDate(cd.lastSessionAt) ?? new Date(),
                sessionStartTime: toDate(cd.lastSessionAt)?.getTime() || Date.now(),
                _isLocal: false,
                _linkedCloudId: cd.id,
                _hasCloudCopy: true,
                _isLegacy: false,
              } as Session;
            })
        );

        const { sessions: legacySessions } = await SessionService.getAllSessions(auth.currentUser!.uid, 500).catch(() => ({ sessions: [] }));
        const seenIds = new Set([
          ...mappedLocal.map(s => s.id),
          ...mappedCloud.map(s => s.id)
        ]);
        const mappedLegacy: Session[] = [];
        for (const s of legacySessions) {
          if (seenIds.has(s.id)) continue;
          seenIds.add(s.id);
          try {
            const decrypted = await maybeDecrypt(s as unknown as Record<string, unknown>, ['content'], ['pinnedThoughts', 'tags']);
            mappedLegacy.push({
              ...(decrypted as unknown as Session),
              _isLocal: false,
              _isLegacy: true,
              _hasCloudCopy: true,
            });
          } catch (e) {
            console.error('Error loading legacy session:', s.id, e);
            mappedLegacy.push({
              ...s,
              _isLocal: false,
              _isLegacy: true,
              _hasCloudCopy: true,
            });
          }
        }

        const combined = [...mappedLocal, ...mappedCloud, ...mappedLegacy];
        combined.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));

        const { AISummaryService } = await import('../../ai/services/AISummaryService');
        const statusMap = await AISummaryService.hasAll();
        
        const mappedSessions = await Promise.all(combined.map(async (s) => {
          const hasSummary = statusMap[s.id];
          if (hasSummary && !s._aiProcessed) {
            const summary = await AISummaryService.get(s.id);
            if (summary) {
              const resultText = `Тональность: ${summary.tone}\nКлючевые слова: ${summary.frequentWords.join(', ')}\nОсновные темы: ${summary.themes.join(', ')}\n\nИнсайты:\n${summary.insights.map(ins => `- ${ins}`).join('\n')}`;
              return { ...s, _aiProcessed: true, _aiAction: 'summarize', _aiResultText: resultText };
            }
          }
          return s;
        }));
        
        setSessions(mappedSessions);
        setHasMoreSessions(false);
      }
    } catch (err) {
      reportError(err, { action: 'adminFetch', tab: activeTab });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setLoading(false);
      setLoadingMoreSessions(false);
    }
  }, [activeTab, showToast, t]);

  useEffect(() => {
    const checkAdmin = async () => {
      if (auth.currentUser) {
        try {
          const profile = await AdminUserService.getProfile(auth.currentUser.uid);
          const adminStatus = profile?.role === 'admin';
          setIsAdmin(adminStatus);
          if (adminStatus) {
            fetchData();
          }
        } catch (e) {
          reportError(e, { action: 'checkAdminStatus' });
          setIsAdmin(false);
        }
      }
    };
    checkAdmin();
  }, [activeTab, fetchData]);

  const handleImportFromCloud = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setImporting(true);
    setImportResult(null);

    const userId = user.uid;
    const result = { total: 0, imported: 0, failed: 0 };

    try {
      const { DocumentService } = await import('../../../core/services/DocumentService');
      const cloudDocs = await DocumentService.getUserDocuments(userId);
      result.total = cloudDocs.length;

      for (const cloudDoc of cloudDocs) {
        try {
          await StorageService.addLocalCopy(userId, cloudDoc.id);
          result.imported++;
          } catch (e) {
            reportError(e, { action: 'importDoc', docId: cloudDoc.id, userId });
            result.failed++;
          }
      }

      setImportResult(result);
      showToast(t('admin_import_result', { imported: result.imported, total: result.total }), 'success');
    } catch (e) {
      reportError(e, { action: 'importFromCloud', userId });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setImporting(false);
    }
  };

  if (!isAdmin) {
    return <div className="text-center py-20 text-red-500">{t('admin_access_denied')}</div>;
  }

  const handleDeleteSession = async (id: string) => {
    const session = sessions.find(s => s.id === id);
    const isLegacy = (session as unknown as Record<string, unknown>)?._isLegacy === true;

    execute(
      async () => {
        if (isLegacy) {
          await AdminSessionService.deleteSession(id);
        } else {
          const userId = auth.currentUser!.uid;
          await LocalDocumentService.deleteDocument(id);
          const hasCloud = (session as unknown as Record<string, unknown>)?._hasCloudCopy || !id.startsWith('local_');
          if (hasCloud) {
            await DocumentService.deleteDocument(userId, id);
          }
        }
      },
      { successMessage: t('save_success'), errorMessage: t('error_delete_failed'), onSuccess: () => setSessions(prev => prev.filter(s => s.id !== id)) }
    );
  };

  const handleProcessSession = async (id: string, content: string) => {
    setProcessingId(id);
    try {
      const session = sessions.find(s => s.id === id);
    const isLegacy = (session as unknown as Record<string, unknown>)?._isLegacy === true;
      if (isLegacy) {
        const result = await AIService.process(content, 'summarize', { sessionId: id });
        if (result.ok) {
          setSessions(prev => prev.map(s => s.id === id ? { ...s, _aiProcessed: true, _aiAction: 'summarize', _aiResultText: result.text } : s));
          showToast('Сессия обработана', 'success');
        } else {
          showToast('Ошибка обработки: ' + result.error, 'error');
        }
      } else {
        if (!content || content.trim().length < 50) {
          showToast('Текст документа слишком короткий для ИИ-анализа (минимум 50 символов)', 'error');
          return;
        }
        const result = await AIService.summarize({ content });
        if (result.ok) {
          const summary = {
            documentId: id,
            tone: result.summary.tone,
            frequentWords: result.summary.frequentWords,
            insights: result.summary.insights,
            themes: result.summary.themes,
            extractedFacts: result.summary.extractedFacts ?? [],
            processedAt: Date.now(),
          };
          const { AISummaryService } = await import('../../ai/services/AISummaryService');
          await AISummaryService.save(summary);

          const db = await getLocalDb();
          const doc = await db.get('documents', id);
          if (doc) {
            await db.put('documents', { ...doc, aiProcessed: true });
          }

          const factsSection = (result.summary.extractedFacts ?? []).length > 0
            ? `\n\nФакты:\n${result.summary.extractedFacts.map(f => `- ${f}`).join('\n')}`
            : '';
          const resultText = `Тональность: ${result.summary.tone}\nКлючевые слова: ${result.summary.frequentWords.join(', ')}\nОсновные темы: ${result.summary.themes.join(', ')}\n\nИнсайты:\n${result.summary.insights.map(ins => `- ${ins}`).join('\n')}${factsSection}`;

          setSessions(prev => prev.map(s => s.id === id ? { ...s, _aiProcessed: true, _aiAction: 'summarize', _aiResultText: resultText } : s));
          showToast('Анализ ИИ завершен успешно', 'success');
        } else {
          showToast('Ошибка обработки: ' + result.error, 'error');
        }
      }
    } catch (e) {
      reportError(e, { action: 'processSession', sessionId: id });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const fetchAIUsage = async () => {
    setAiUsageLoading(true);
    try {
      if (users.length === 0) {
        const usersData = await AdminUserService.getUsers(150);
        setUsers(usersData);
      }
      const functions = getFunctions();
      const fn = httpsCallable<{ date: string }, { stats: AIUsageRow[] }>(functions, 'getAIUsageStats');
      const { data } = await fn({ date: aiUsageDate });
      setAiUsage(data.stats);
    } catch (e) {
      reportError(e, { action: 'fetchAIUsage' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setAiUsageLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8 pb-20"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold flex items-center gap-3 text-text-main">
          <Shield className="text-red-500" />
          {t('admin_title')}
        </h2>
      </div>

      {/* Import from cloud */}
      <div className="bg-surface-card border border-border-subtle rounded-2xl p-6">
        <h3 className="text-base font-medium text-text-main mb-2">
          {t('admin_import_title')}
        </h3>
        <p className="text-sm text-text-main/50 mb-4">
          {t('admin_import_hint')}
        </p>

        <button
          onClick={handleImportFromCloud}
          disabled={importing}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-text-main text-surface-base text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {importing
            ? <><Loader size={14} className="animate-spin" /> {t('admin_importing')}</>
            : <><Download size={14} /> {t('admin_import_button')}</>
          }
        </button>

        {importResult && (
          <div className="mt-3 text-sm text-text-main/60">
            {t('admin_import_done', { imported: importResult.imported, total: importResult.total })}
            {importResult.failed > 0 && ` · ${t('admin_import_failed', { count: importResult.failed })}`}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 rounded-2xl w-fit bg-surface-base/10 border border-border-subtle">
        <button 
          onClick={() => setActiveTab('users')}
          className={cn(
            "flex items-center gap-2 px-6 py-2 rounded-2xl text-sm font-bold transition-colors",
            activeTab === 'users' 
              ? "bg-surface-base/20 text-text-main shadow-sm" 
              : "text-text-main/50 hover:text-text-main"
          )}
        >
          <Users size={16} />
          {t('admin_tab_users')}
        </button>
        <button 
          onClick={() => setActiveTab('sessions')}
          className={cn(
            "flex items-center gap-2 px-6 py-2 rounded-2xl text-sm font-bold transition-colors",
            activeTab === 'sessions' 
              ? "bg-surface-base/20 text-text-main shadow-sm" 
              : "text-text-main/50 hover:text-text-main"
          )}
        >
          <Database size={16} />
          {t('admin_tab_sessions')}
        </button>
        <button 
          onClick={() => setActiveTab('security')}
          className={cn(
            "flex items-center gap-2 px-6 py-2 rounded-2xl text-sm font-bold transition-colors",
            activeTab === 'security' 
              ? "bg-surface-base/20 text-text-main shadow-sm" 
              : "text-text-main/50 hover:text-text-main"
          )}
        >
          <AlertTriangle size={16} />
          {t('admin_tab_security')}
        </button>
        <button 
          onClick={() => setActiveTab('diagnostics')}
          className={cn(
            "flex items-center gap-2 px-6 py-2 rounded-2xl text-sm font-bold transition-colors",
            activeTab === 'diagnostics' 
              ? "bg-surface-base/20 text-text-main shadow-sm" 
              : "text-text-main/50 hover:text-text-main"
          )}
        >
          <RefreshCw size={16} />
          {t('admin_tab_diagnostics')}
        </button>
        <button 
          onClick={() => { setActiveTab('ai'); fetchAIUsage(); }}
          className={cn(
            "flex items-center gap-2 px-6 py-2 rounded-2xl text-sm font-bold transition-colors",
            activeTab === 'ai' 
              ? "bg-surface-base/20 text-text-main shadow-sm" 
              : "text-text-main/50 hover:text-text-main"
          )}
        >
          <Sparkles size={16} />
          AI Usage
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <LoadingSpinner size={10} />
        </div>
      ) : (
        <div className="rounded-3xl overflow-hidden transition-colors bg-surface-card backdrop-blur-2xl border border-border-subtle shadow-sm">
          {activeTab === 'users' && (
            <AdminUsersTable users={users} />
          )}

          {activeTab === 'sessions' && (
            <>
              <AdminSessionsTable sessions={sessions} onDelete={setDeleteSessionId} onProcess={handleProcessSession} onRead={t => setReadText(t)} />
              {hasMoreSessions && (
                <div className="p-6 flex justify-center border-t border-border-subtle">
                  <button
                    onClick={() => fetchData(false)}
                    disabled={loadingMoreSessions}
                    className="px-8 py-2 rounded-2xl font-bold transition-colors disabled:opacity-50 bg-text-main text-surface-base shadow-lg"
                  >
                    {loadingMoreSessions ? t('archive_loading_more') : t('archive_load_more')}
                  </button>
                </div>
              )}
            </>
          )}

          {activeTab === 'security' && (
            <div className="p-8 space-y-6">
              <div className="p-6 rounded-2xl border bg-emerald-500/10 border-emerald-500/30">
                <h4 className="font-bold mb-2 flex items-center gap-2 text-emerald-400">
                  <Shield size={18} />
                  {t('admin_security_active')}
                </h4>
                <ul className="text-sm space-y-1 list-disc list-inside text-emerald-400/80">
                  <li>{t('admin_security_validation')}</li>
                  <li>{t('admin_security_size_limits')}</li>
                  <li>{t('admin_security_typing')}</li>
                  <li>{t('admin_security_uid_protection')}</li>
                  <li>{t('admin_security_email_validation')}</li>
                </ul>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-6 rounded-2xl border bg-surface-base/5 border-border-subtle">
                  <span className="text-xs font-bold uppercase tracking-widest text-text-main/50">{t('admin_security_xss_title')}</span>
                  <p className="text-sm mt-2 text-text-main/80">{t('admin_security_xss')}</p>
                </div>
                <div className="p-6 rounded-2xl border bg-surface-base/5 border-border-subtle">
                  <span className="text-xs font-bold uppercase tracking-widest text-text-main/50">{t('admin_security_csrf_title')}</span>
                  <p className="text-sm mt-2 text-text-main/80">{t('admin_security_csrf')}</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'diagnostics' && (
            <div className="p-6">
              <SyncDiagnostics userId={auth.currentUser?.uid ?? ''} />
            </div>
          )}

          {activeTab === 'ai' && (() => {
            const COST_IN = 0.000000075;
            const COST_OUT = 0.00000030;
            const q = aiSearchQuery.toLowerCase();
            const filtered = q
              ? aiUsage.filter(row => {
                  const profile = users.find(u => u.uid === row.uid);
                  const email = profile?.email?.toLowerCase() ?? '';
                  const nick = profile?.nickname?.toLowerCase() ?? '';
                  return row.uid.toLowerCase().includes(q) || email.includes(q) || nick.includes(q);
                })
              : aiUsage;
            const totalCost = filtered.reduce((s, r) => s + r.promptTokens * COST_IN + r.completionTokens * COST_OUT, 0);
            return (
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <input
                    type="date"
                    value={aiUsageDate}
                    onChange={e => setAiUsageDate(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-text-main/5 border border-border-subtle text-sm text-text-main outline-none"
                  />
                  <button
                    onClick={fetchAIUsage}
                    disabled={aiUsageLoading}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-text-main text-surface-base text-sm font-medium disabled:opacity-50"
                  >
                    {aiUsageLoading ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Обновить
                  </button>
                </div>

                <input
                  type="text"
                  value={aiSearchQuery}
                  onChange={e => setAiSearchQuery(e.target.value)}
                  placeholder="Поиск по email / никнейму / uid..."
                  className="w-full px-3 py-2 rounded-lg bg-text-main/5 border border-border-subtle text-sm text-text-main placeholder:text-text-main/30 outline-none focus:border-brand-soft/40"
                />

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border-subtle">
                        <th className="text-left py-2 px-3 text-text-main/50 font-medium">Пользователь</th>
                        <th className="text-right py-2 px-3 text-text-main/50 font-medium">Запросы</th>
                        <th className="text-right py-2 px-3 text-text-main/50 font-medium">Tokens In</th>
                        <th className="text-right py-2 px-3 text-text-main/50 font-medium">Tokens Out</th>
                        <th className="text-right py-2 px-3 text-text-main/50 font-medium">Итого токенов</th>
                        <th className="text-right py-2 px-3 text-text-main/50 font-medium">Стоимость (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(row => {
                        const profile = users.find(u => u.uid === row.uid);
                        const displayName = profile
                          ? `${profile.nickname ?? ''} (${profile.email ?? ''})`
                          : row.uid.slice(0, 8) + '...';
                        const cost = row.promptTokens * COST_IN + row.completionTokens * COST_OUT;
                        return (
                          <tr key={row.uid} className="border-b border-border-subtle/50 hover:bg-text-main/[0.02]">
                            <td className="py-2 px-3 text-text-main/60" title={row.uid}>{displayName}</td>
                            <td className="py-2 px-3 text-right text-text-main/60">{row.requests}</td>
                            <td className="py-2 px-3 text-right text-text-main/60">{row.promptTokens.toLocaleString()}</td>
                            <td className="py-2 px-3 text-right text-text-main/60">{row.completionTokens.toLocaleString()}</td>
                            <td className="py-2 px-3 text-right text-text-main/60">{(row.promptTokens + row.completionTokens).toLocaleString()}</td>
                            <td className="py-2 px-3 text-right text-text-main/60">${cost.toFixed(5)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {filtered.length > 0 && (
                      <tfoot>
                        <tr className="border-t border-border-subtle font-medium">
                          <td className="py-2 px-3 text-text-main/70">Итого</td>
                          <td className="py-2 px-3 text-right text-text-main/70">{filtered.reduce((s, r) => s + r.requests, 0)}</td>
                          <td className="py-2 px-3 text-right text-text-main/70">{filtered.reduce((s, r) => s + r.promptTokens, 0).toLocaleString()}</td>
                          <td className="py-2 px-3 text-right text-text-main/70">{filtered.reduce((s, r) => s + r.completionTokens, 0).toLocaleString()}</td>
                          <td className="py-2 px-3 text-right text-text-main/70">{filtered.reduce((s, r) => s + r.promptTokens + r.completionTokens, 0).toLocaleString()}</td>
                          <td className="py-2 px-3 text-right text-text-main/70">${totalCost.toFixed(5)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                {aiUsage.length === 0 && !aiUsageLoading && (
                  <div className="py-8 text-center text-xs text-text-main/25">Нет данных за выбранную дату</div>
                )}
              </div>
            );
          })()}
        </div>
      )}
      <CancelConfirmModal
        isOpen={!!deleteSessionId}
        title={t('admin_confirm_delete_session')}
        description={t('admin_confirm_delete_session_desc')}
        confirmLabel={t('session_delete')}
        cancelLabel={t('writing_cancel')}
        onConfirm={() => {
          if (deleteSessionId) handleDeleteSession(deleteSessionId);
          setDeleteSessionId(null);
        }}
        onCancel={() => setDeleteSessionId(null)}
      />

      {readText !== null && (
        <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center" onClick={() => setReadText(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-lg mx-4 bg-surface-card border border-border-subtle rounded-2xl shadow-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
              <h3 className="text-base font-bold text-text-main">Результат анализа AI</h3>
              <button onClick={() => setReadText(null)} className="p-2 rounded-lg text-text-main/40 hover:text-text-main transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto text-sm text-text-main/80 leading-relaxed whitespace-pre-wrap">
              {readText || '(пусто)'}
            </div>
            <div className="px-6 py-3 border-t border-border-subtle flex justify-end">
              <button onClick={() => setReadText(null)} className="px-4 py-2 rounded-xl bg-text-main text-surface-base text-sm font-medium">Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
