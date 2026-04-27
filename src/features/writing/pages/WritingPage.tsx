import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { useWritingStore } from '../store/useWritingStore';
import { Session, UserProfile, SessionPayload } from '../../../types';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useSettings } from '../../../core/settings/SettingsContext';
import { cn } from '../../../core/utils/utils';
import { GoalToast } from '../../../shared/components/GoalToast';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLoginModal } from '../../auth/contexts/LoginModalContext';

// Components
import { WritingHeader } from '../WritingHeader';
import { WritingEditor } from '../WritingEditor';
import { WritingFinishModal } from '../WritingFinishModal';
import { LifeLogPanel } from '../components/LifeLogPanel';
import { WritingSessionService } from '../services/WritingSessionService';
import { WritingDraftService } from '../services/WritingDraftService';
import { FlowPulse } from '../../../core/theme/FlowPulse';
import { BottomStats } from '../components/BottomStats';
import { Sidebar } from '../../navigation/components/Sidebar';
import { PenLine, LogIn } from 'lucide-react';

// Modals
import { PasswordPromptModal } from '../components/modals/PasswordPromptModal';
import { CancelConfirmModal } from '../components/modals/CancelConfirmModal';

// Hooks
import { useWritingSession } from '../hooks/useWritingSession';
import { useSessionList } from '../hooks/useSessionList';
import { useSessionContinue } from '../hooks/useSessionContinue';
import { useSessionFlow } from '../hooks/useSessionFlow';
import { useLanguage } from '../../../core/i18n';
import { ConnectionStatusBanner } from '../components/ConnectionStatusBanner';
import { MobileWriteScreen } from '../components/MobileWriteScreen';
import { MobileHomeScreen } from '../components/MobileHomeScreen';
import { useLifeLog } from '../hooks/useLifeLog';
import { useDocuments } from '../hooks/useDocuments';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { SyncService } from '../services/SyncService';
import { useToast } from '../../../shared/components/Toast';

import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { useServiceAction } from '../hooks/useServiceAction';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { LocalVersionService } from '../services/LocalVersionService';
import { UnifiedSessionService } from '../services/UnifiedSessionService';
import { useSessionSource } from '../hooks/useSessionSource';
import { z } from 'zod';
import { SaveData } from '../WritingFinishModal';

interface WritingViewProps {
  user: User | null;
  profile: UserProfile | null;
}

function GuestWritingPage() {
  const { t } = useLanguage();
  const { openLoginModal } = useLoginModal();
  const content = useWritingStore(s => s.content);
  const setContent = useWritingStore(s => s.setContent);
  const status = useWritingStore(s => s.status);
  const seconds = useWritingStore(s => s.seconds);
  const wordCount = useWritingStore(s => s.wordCount);
  const title = useWritingStore(s => s.title);
  const setTitle = useWritingStore(s => s.setTitle);
  const sessionType = useWritingStore(s => s.sessionType);
  const { editorWidth, isZenActive, zenModeEnabled } = useWritingSettings();
  const showZen = isZenActive && zenModeEnabled;
  const { showToast } = useToast();
  const [localDocuments, setLocalDocuments] = useState<import('../../../shared/lib/localDb').LocalDocument[]>([]);
  const [savingLocally, setSavingLocally] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveChoice, setSaveChoice] = useState<'new' | 'existing' | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const guestId = React.useMemo(() => {
    const KEY = 'jw_guest_id';
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `guest_${crypto.randomUUID()}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  }, []);

  const loadLocalDocuments = React.useCallback(async () => {
    const docs = await LocalDocumentService.getGuestDocuments(guestId);
    setLocalDocuments(docs);
  }, [guestId]);

  useEffect(() => {
    loadLocalDocuments();
  }, [loadLocalDocuments]);

  React.useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (status === 'writing') {
      interval = setInterval(() => {
        useWritingStore.getState().tick();
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [status]);

  const handleStart = React.useCallback(() => {
    useWritingStore.getState().setSessionType('free');
    useWritingStore.getState().setSessionStart();
    useWritingStore.getState().setStatus('writing');
  }, []);

  const handlePause = React.useCallback(() => {
    if (useWritingStore.getState().status === 'writing') {
      useWritingStore.getState().setStatus('paused');
    }
  }, []);

  const handleFinish = React.useCallback(() => {
    setShowSaveForm(true);
    setSaveTitle(title || '');
    setSaveChoice(null);
  }, [title]);

  const handleGuestSave = React.useCallback(async () => {
    if (savingLocally) return;
    setSavingLocally(true);

    try {
      const state = useWritingStore.getState();
      const sessionSeconds = state.accumulatedDuration + (state.seconds - state.sessionStartSeconds);

      if (saveChoice === 'new' || !selectedDocId) {
        await UnifiedSessionService.saveAsNewDocument(guestId, {
          title: saveTitle,
          content: state.content,
          wordCount: state.wordCount,
          duration: sessionSeconds,
          wpm: state.wpm,
          isPublic: false,
          tags: [],
          sessionStartedAt: new Date(Date.now() - sessionSeconds * 1000),
        }, 'local');
      } else {
        await UnifiedSessionService.saveAsVersion(guestId, selectedDocId, {
          title: saveTitle,
          content: state.content,
          wordCount: state.wordCount,
          duration: sessionSeconds,
          wpm: state.wpm,
          isPublic: false,
          tags: [],
          sessionStartedAt: new Date(Date.now() - sessionSeconds * 1000),
        }, 'local');
      }

      await loadLocalDocuments();
      useWritingStore.getState().resetSession();
      useWritingStore.setState({ title: '', content: '' });
      setShowSaveForm(false);
      setSaveChoice(null);
      setSelectedDocId(null);
      showToast(t('guest_saved_locally'), 'success');
    } catch (e) {
      console.error('Local save failed:', e);
      showToast(t('save_error'), 'error');
    } finally {
      setSavingLocally(false);
    }
  }, [savingLocally, saveChoice, selectedDocId, saveTitle, guestId, loadLocalDocuments, showToast, t]);

  const handleContinueLocalDoc = React.useCallback(async (docId: string) => {
    const latestContent = await LocalVersionService.getLatestContent(docId);
    if (latestContent) {
      useWritingStore.setState({ content: latestContent });
    }
    const doc = localDocuments.find(d => d.id === docId);
    if (doc) {
      useWritingStore.setState({ title: doc.title });
      setSelectedDocId(doc.id);
    }
    useWritingStore.getState().setSessionType('free');
    useWritingStore.getState().setSessionStart();
    useWritingStore.getState().setStatus('writing');
  }, [localDocuments]);

  const handleCancelSession = React.useCallback(() => {
    useWritingStore.getState().resetSession();
    useWritingStore.setState({ title: '', content: '' });
    setShowSaveForm(false);
  }, []);

  return (
    <div className="w-full min-h-screen flex flex-col items-center bg-surface-base">
      <div className={cn(
        "w-full transition-colors duration-1000 flex-1 flex flex-col",
        editorWidth < 100 ? "max-w-4xl mx-auto" : ""
      )}>
        <AnimatePresence>
          {status !== 'idle' && !showSaveForm && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center justify-between px-6 py-3 border-b border-border-subtle"
            >
              <div className="flex items-center gap-4 text-sm text-text-main/50">
                <span>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
                <span>{wordCount} {t('writing_words')}</span>
              </div>
              <div className="flex items-center gap-2">
                {status === 'writing' && (
                  <button onClick={handlePause} className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-main/60 hover:text-text-main bg-text-main/5 hover:bg-text-main/10 transition-colors">
                    {t('pause')}
                  </button>
                )}
                {status === 'paused' && (
                  <button onClick={handleStart} className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-main/60 hover:text-text-main bg-text-main/5 hover:bg-text-main/10 transition-colors">
                    {t('header_continue_btn')}
                  </button>
                )}
                <button onClick={handleFinish} className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-main/60 hover:text-text-main bg-text-main/5 hover:bg-text-main/10 transition-colors">
                  {t('header_finish')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 flex flex-col items-center justify-center px-4">
          {showSaveForm ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-md space-y-6 p-6 rounded-2xl border border-border-subtle bg-surface-card"
            >
              <h2 className="text-lg font-bold text-text-main">{t('guest_save_title')}</h2>

              {!saveChoice && (
                <div className="space-y-3">
                  <button
                    onClick={() => setSaveChoice('new')}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all bg-text-main text-surface-base"
                  >
                    {t('guest_save_new_document')}
                  </button>
                  {localDocuments.length > 0 && (
                    <button
                      onClick={() => setSaveChoice('existing')}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all border bg-surface-base/5 border-border-subtle hover:bg-surface-base/10 text-text-main/70"
                    >
                      {t('guest_save_existing_document')}
                    </button>
                  )}
                  <button
                    onClick={handleCancelSession}
                    className="w-full py-2 text-sm text-text-main/40 hover:text-text-main/70 transition-colors"
                  >
                    {t('common_cancel')}
                  </button>
                </div>
              )}

              {saveChoice === 'new' && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-widest ml-1 text-text-main/50">{t('editor_title_placeholder')}</label>
                    <input
                      type="text"
                      value={saveTitle}
                      onChange={e => setSaveTitle(e.target.value)}
                      placeholder={t('editor_title_placeholder')}
                      className="w-full mt-1 px-4 py-3 rounded-xl outline-none transition-all bg-surface-base/5 border border-border-subtle text-text-main focus:ring-2 focus:ring-text-main/20 placeholder:text-text-main/20"
                    />
                  </div>
                  <button
                    onClick={handleGuestSave}
                    disabled={savingLocally}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all bg-text-main text-surface-base disabled:opacity-50"
                  >
                    {savingLocally ? <div className="w-4 h-4 border-2 rounded-full animate-spin border-surface-base/20 border-t-surface-base" /> : null}
                    {t('guest_save_button')}
                  </button>
                  <button onClick={() => setSaveChoice(null)} className="w-full py-2 text-sm text-text-main/40 hover:text-text-main/70 transition-colors">
                    {t('finish_back')}
                  </button>
                </div>
              )}

              {saveChoice === 'existing' && (
                <div className="space-y-3">
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {localDocuments.map(doc => (
                      <button
                        key={doc.id}
                        onClick={() => setSelectedDocId(selectedDocId === doc.id ? null : doc.id)}
                        className={cn(
                          "w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-left transition-all",
                          selectedDocId === doc.id
                            ? "bg-text-main text-surface-base"
                            : "hover:bg-text-main/5 text-text-main/70"
                        )}
                      >
                        <div>
                          <div className="text-sm font-medium">{doc.title || t('common_untitled')}</div>
                          <div className={cn("text-xs", selectedDocId === doc.id ? "text-surface-base/60" : "text-text-main/40")}>
                            v{doc.currentVersion} · {doc.totalWords.toLocaleString()} {t('home_words_short')}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleGuestSave}
                    disabled={savingLocally || !selectedDocId}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all bg-text-main text-surface-base disabled:opacity-50"
                  >
                    {savingLocally ? <div className="w-4 h-4 border-2 rounded-full animate-spin border-surface-base/20 border-t-surface-base" /> : null}
                    {t('guest_save_button')}
                  </button>
                  <button onClick={() => setSaveChoice(null)} className="w-full py-2 text-sm text-text-main/40 hover:text-text-main/70 transition-colors">
                    {t('finish_back')}
                  </button>
                </div>
              )}
            </motion.div>
          ) : status === 'idle' ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center space-y-6 max-w-md"
            >
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-black text-2xl mx-auto bg-text-main text-surface-base">
                J
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-text-main">justwriting.one</h1>
              <p className="text-text-main/50">{t('guest_welcome_subtitle')}</p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleStart}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold hover:scale-[1.02] active:scale-[0.98] transition-all bg-text-main text-surface-base"
                >
                  <PenLine size={18} />
                  {t('guest_start_writing')}
                </button>
                <button
                  onClick={openLoginModal}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all border bg-surface-base/5 border-border-subtle hover:bg-surface-base/10 text-text-main/70"
                >
                  <LogIn size={16} />
                  {t('auth_sign_in')}
                </button>
              </div>
              <p className="text-xs text-text-main/30">{t('guest_save_hint')}</p>

              {localDocuments.length > 0 && (
                <div className="mt-8 space-y-2 text-left">
                  <div className="text-[10px] text-text-subtle font-bold uppercase tracking-wider px-1">
                    {t('guest_local_documents')} ({localDocuments.length})
                  </div>
                  {localDocuments.slice(0, 5).map(doc => (
                    <button
                      key={doc.id}
                      onClick={() => handleContinueLocalDoc(doc.id)}
                      className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl hover:bg-text-main/5 transition-colors text-left"
                    >
                      <div>
                        <div className="text-sm font-medium text-text-main/85">{doc.title || t('common_untitled')}</div>
                        <div className="text-xs text-text-main/40">
                          v{doc.currentVersion} · {doc.totalWords.toLocaleString()} {t('home_words_short')}
                        </div>
                      </div>
                    </button>
                  ))}
                  {localDocuments.length > 5 && (
                    <p className="text-xs text-text-main/30 px-1">{t('guest_more_documents', { count: localDocuments.length - 5 })}</p>
                  )}
                </div>
              )}
            </motion.div>
          ) : (
            <div className="w-full max-w-3xl mx-auto py-8">
              <WritingEditor
                handlePause={handlePause}
                handleStart={handleStart}
                handleFinish={handleFinish}
                setShowCancelConfirm={() => {}}
                saveStatus="idle"
                lastSavedAt={null}
              />
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-6 p-4 rounded-xl border border-border-subtle bg-surface-card/50 text-center"
              >
                <p className="text-sm text-text-main/50 mb-3">{t('guest_save_prompt')}</p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={handleFinish}
                    className="px-5 py-2 rounded-xl border border-border-subtle text-sm font-medium text-text-main/70 hover:bg-text-main/5 transition-colors"
                  >
                    {t('guest_save_local')}
                  </button>
                  <button
                    onClick={openLoginModal}
                    className="px-6 py-2.5 rounded-xl bg-text-main text-surface-base text-sm font-medium hover:scale-105 transition-transform"
                  >
                    {t('auth_sign_in')}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WritingPageContent({ user, profile }: WritingViewProps) {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const sessionToContinue = (location.state as { sessionToContinue?: Session | null } | null)?.sessionToContinue || null;

  const timeGoalReached = useWritingStore(s => s.timeGoalReached);
  const wordGoalReached = useWritingStore(s => s.wordGoalReached);

  const {
    sessionType, setSessionType,
    setTimerDuration,
    setWordGoal,
    targetTime, setTargetTime,
    seconds,
    isPublic, setIsPublic,
    isAnonymous, setIsAnonymous,
    tags, setTags,
    labelId, setLabelId,
    hasDraft,
    saveStatus, lastSavedAt,
    handleStart: hookHandleStart, handleSave: hookHandleSave, handleCancel, resetSessionMetadata,
    isOnline,
    fetchLocalSessions,
    loadLocalSession,
    encryptionPassword, setEncryptionPassword,
    decryptSession,
    setActiveSessionId
  } = useWritingSession(user, profile);

  const { 
    isZenActive, zenModeEnabled, 
    editorWidth, 
    setStatus: setUIStatus,
    lifeLogEnabled,
    lifeLogVisible, setLifeLogVisible,
    lifeLogTab, setLifeLogTab,
    lifeLogPinned, setLifeLogPinned
  } = useWritingSettings();
  const source = useSessionSource();
  const isBrowserOnline = useOnlineStatus();

  useEffect(() => {
    if (isBrowserOnline && user) {
      SyncService.syncPending(user.uid).catch(console.error);
    }
  }, [isBrowserOnline, user]);

  const effectiveSource = !isBrowserOnline && source === 'cloud' ? 'local' : source;
  const showZen = isZenActive && zenModeEnabled;
  const { showToast } = useToast();
  const { execute: svcExecute } = useServiceAction();
  const title = useWritingStore(s => s.title);
  const setTitle = useWritingStore(s => s.setTitle);
  
  const sessionStatus = useWritingStore(s => s.status);
  const setSessionStatus = useWritingStore(s => s.setStatus);
  const wordGoal = useWritingStore(s => s.wordGoal);
  const timerDuration = useWritingStore(s => s.timerDuration);
  const wordCount = useWritingStore(s => s.wordCount);

  const flow = useSessionFlow(
    hookHandleStart, sessionStatus, sessionType, setSessionType,
    targetTime, seconds, timeGoalReached, wordGoalReached
  );

  const handleFinish = () => setSessionStatus('finished');

  const [isLocalOnly, setIsLocalOnly] = useState(false);
  const { openSettings } = useSettings();
  const savingRef = React.useRef(false);
  const editorColRef = React.useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);
  const { layoutMode } = useLayoutMode();

  React.useEffect(() => {
    const el = editorColRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setIsCompact(entry.contentRect.width < 600);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { continueSession, passwordPrompt, handlePromptSubmit, handlePromptCancel } = useSessionContinue({
    setSetupMode: flow.setSetupMode,
    setIsLocalOnly,
    setActiveSessionId,
    setTags,
    setIsPublic,
    setIsAnonymous,
    loadLocalSession,
    decryptSession
  });

  const handleContinueSession = React.useCallback(async (session: Session) => {
    try {
      await continueSession(session);
      flow.setSetupMode(null);
      setSessionStatus('writing');
      useWritingStore.getState().setSessionStart();
      useWritingStore.setState({
        wpm: 0,
        wordSnapshots: [],
        lastWordCount: 0,
      });
    } catch (err) {
      console.error('Continue session error:', err);
      showToast(t('error_continue_session'));
    }
  }, [continueSession, setSessionStatus, flow, showToast, t]);

  const [firstVisit, setFirstVisit] = useLocalStorage('first-visit', true, z.boolean());

  const { documents, refresh: refreshDocuments } = useDocuments(user.uid);

  useEffect(() => {
    setUIStatus(sessionStatus);
  }, [sessionStatus, setUIStatus]);

  const { userSessions, loadingSessions, fetchAllSessions: fetchSessions } = useSessionList(
    user.uid,
    fetchLocalSessions,
    loadLocalSession
  );

  useEffect(() => {
    if (sessionToContinue) {
      continueSession(sessionToContinue);
      navigate(location.pathname, { state: {}, replace: true });
    }
  }, [sessionToContinue, continueSession, navigate, location.pathname]);

  const handleNewSession = () => {
    resetSessionMetadata();
    flow.setSetupMode('selection');
  };

  const handleNew = () => {
    const state = useWritingStore.getState();
    if (state.wordCount > 0 && state.status !== 'idle') {
      flow.setShowCancelConfirm(true);
      return;
    }
    useWritingStore.getState().resetSession();
    useWritingStore.setState({ title: '', content: '' });
  };

  const handleOpen = async () => {
    await fetchSessions();
    setLifeLogVisible(true);
  };

  const handleSave = React.useCallback(async () => {
    if (sessionStatus === 'idle' || wordCount === 0) return;
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const state = useWritingStore.getState();
      
      const sessionData: SessionPayload = {
        userId: user.uid,
        authorName: profile?.nickname || user.displayName || user.email?.split('@')[0] || 'Anonymous',
        authorPhoto: user.photoURL || '',
        nickname: profile?.nickname || '',
        isAnonymous: isAnonymous,
        title: state.title || '',
        content: state.content,
        pinnedThoughts: state.pinnedThoughts,
        duration: state.accumulatedDuration + (state.seconds - state.sessionStartSeconds),
        wordCount: state.wordCount,
        charCount: state.content.length,
        wpm: state.wpm,
        isPublic: isPublic,
        tags: tags,
        sessionType: state.sessionType,
        sessionStartTime: state.sessionStartTime,
        goalReached: state.sessionType === 'timer' ? state.timeGoalReached : (state.sessionType === 'words' ? state.wordGoalReached : true),
      };

      const savedId = await WritingSessionService.saveSession(
        sessionData, 
        state.activeSessionId, 
        isOnline, 
        user.uid
      );
      
      if (savedId && !state.activeSessionId) {
        useWritingStore.getState().setActiveSessionId(savedId);
      }
      
      await fetchSessions();
      showToast(t('save_success'), 'success');
    } catch (e) {
      console.error('Save failed:', e);
      showToast(t('save_error'), 'error');
    } finally {
      savingRef.current = false;
    }
  }, [sessionStatus, wordCount, user, isPublic, isAnonymous, tags, profile, isOnline, showToast, t, fetchSessions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        if (sessionStatus === 'writing' || sessionStatus === 'paused') {
          e.preventDefault();
          
          if (sessionStatus === 'writing') {
            handlePauseRef.current();
          } else if (sessionStatus === 'paused') {
            handlePlayRef.current();
          }
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionStatus, handleSave]);

  const handlePlay = React.useCallback(() => {
    if (sessionStatus === 'idle') {
      useWritingStore.getState().setSessionType('free');
      useWritingStore.getState().setSessionStart();
      hookHandleStart();
    } else if (sessionStatus === 'paused') {
      useWritingStore.getState().setStatus('writing');
    }
  }, [sessionStatus, hookHandleStart]);

  const handlePause = () => {
    if (sessionStatus !== 'writing') return;
    useWritingStore.getState().setStatus('paused');
  };

  const handleStop = async () => {
    if (sessionStatus === 'idle') return;
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      await handleSave();
      useWritingStore.getState().finishSession();
      await WritingDraftService.deleteDraft(user.uid);
    } finally {
      savingRef.current = false;
    }
  };

  const handlePlayRef = React.useRef(handlePlay);
  const handlePauseRef = React.useRef(handlePause);

  const handleSaveAsNewDocument = React.useCallback(async (data: SaveData) => {
    const state = useWritingStore.getState();
    const sessionSeconds = state.accumulatedDuration + (state.seconds - state.sessionStartSeconds);

    await UnifiedSessionService.saveAsNewDocument(user.uid, {
      title: data.title,
      content: state.content,
      wordCount: state.wordCount,
      duration: sessionSeconds,
      wpm: state.wpm,
      isPublic: data.isPublic,
      tags: data.tags,
      labelId: data.labelId,
      goalWords: state.wordGoal > 0 ? state.wordGoal : undefined,
      goalTime: state.timerDuration > 0 ? state.timerDuration : undefined,
      goalReached: state.wordGoal > 0 && state.wordCount >= state.wordGoal,
      sessionStartedAt: new Date(Date.now() - sessionSeconds * 1000),
    }, effectiveSource);

    await refreshDocuments();
    useWritingStore.getState().finishSession();
    await WritingDraftService.deleteDraft(user.uid);
  }, [user.uid, refreshDocuments, effectiveSource]);

  const handleSaveAsVersion = React.useCallback(async (documentId: string, data: SaveData) => {
    const state = useWritingStore.getState();
    const sessionSeconds = state.accumulatedDuration + (state.seconds - state.sessionStartSeconds);

    await UnifiedSessionService.saveAsVersion(user.uid, documentId, {
      title: data.title,
      content: state.content,
      wordCount: state.wordCount,
      duration: sessionSeconds,
      wpm: state.wpm,
      isPublic: data.isPublic,
      tags: data.tags,
      labelId: data.labelId,
      goalWords: state.wordGoal > 0 ? state.wordGoal : undefined,
      goalTime: state.timerDuration > 0 ? state.timerDuration : undefined,
      goalReached: state.wordGoal > 0 && state.wordCount >= state.wordGoal,
      sessionStartedAt: new Date(Date.now() - sessionSeconds * 1000),
    }, effectiveSource);

    await refreshDocuments();
    useWritingStore.getState().finishSession();
    await WritingDraftService.deleteDraft(user.uid);
  }, [user.uid, effectiveSource, refreshDocuments]);

  useEffect(() => {
    handlePlayRef.current = handlePlay;
    handlePauseRef.current = handlePause;
  }, [handlePlay, handlePause]);

  const handleAutoStartKey = React.useCallback((e: KeyboardEvent) => {
    if (sessionStatus !== 'idle') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length !== 1) return;

    handlePlayRef.current();
  }, [sessionStatus]);

  useEffect(() => {
    window.addEventListener('keydown', handleAutoStartKey);
    return () => window.removeEventListener('keydown', handleAutoStartKey);
  }, [handleAutoStartKey]);

  const fetchAllSessions = async () => {
    await fetchSessions();
    flow.setSetupMode('session-selection');
  };

  const LIFE_LOG_WIDTH = 380;
  const isMobile = layoutMode !== 'desktop';

  const { sessionGroups: lifeLogGroups, summary: lifeLogSummary } = useLifeLog(user.uid, false);
  const streakDays = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let streak = 0;
    let checkDate = new Date(today);
    for (let i = 0; i < 365; i++) {
      const dateStr = checkDate.toDateString();
      const hasSession = lifeLogGroups.some(g =>
        new Date(g.date).toDateString() === dateStr
      );
      if (hasSession) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }, [lifeLogGroups]);

  const mobileModals = (
    <>
      <GoalToast visible={flow.goalToastVisible} type={flow.goalToastType} />
      <AnimatePresence>
        {flow.sessionStartFlash && (
          <motion.div
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="fixed inset-0 z-[200] bg-text-main pointer-events-none"
          />
        )}
      </AnimatePresence>
      <PasswordPromptModal 
        isOpen={!!passwordPrompt}
        onConfirm={handlePromptSubmit}
        onCancel={handlePromptCancel}
      />
      <CancelConfirmModal 
        isOpen={flow.showCancelConfirm}
        onConfirm={() => { handleCancel(); flow.setShowCancelConfirm(false); }}
        onCancel={() => flow.setShowCancelConfirm(false)}
      />
      <WritingFinishModal 
        isOpen={sessionStatus === 'finished'}
        onClose={() => useWritingStore.getState().finishSession()}
        onConfirm={() => { hookHandleSave(isLocalOnly); }}
        title={title} setTitle={setTitle}
        sessionType={sessionType} wordCount={wordCount} duration={seconds}
        isPublic={isPublic} setIsPublic={setIsPublic}
        isAnonymous={isAnonymous} setIsAnonymous={setIsAnonymous}
        handleSave={(localOnly?: boolean) => hookHandleSave(localOnly ?? isLocalOnly)}
        tags={tags} setTags={setTags}
        labelId={labelId} setLabelId={setLabelId}
        labels={profile?.labels || []}
        isLocalOnly={isLocalOnly}
        existingDocuments={documents}
        onSaveAsNew={handleSaveAsNewDocument}
        onSaveAsVersion={handleSaveAsVersion}
      />
      <FlowPulse />
    </>
  );

  if (isMobile) {
    if (sessionStatus === 'idle') {
      return (
        <>
          <MobileHomeScreen
            userId={user.uid}
            streakDays={streakDays}
            sessionGroups={lifeLogGroups}
            summary={lifeLogSummary}
            onStart={handlePlay}
            onContinue={handleContinueSession}
          />
          {mobileModals}
        </>
      );
    }
    return (
      <>
        <MobileWriteScreen
          onPlay={handlePlay}
          onPause={handlePause}
          onStop={handleStop}
          saveStatus={saveStatus}
        />
        {mobileModals}
      </>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full transition-colors duration-1000"
    >
      <>
        <ConnectionStatusBanner isOnline={isOnline} showZen={showZen} />
        <GoalToast visible={flow.goalToastVisible} type={flow.goalToastType} />

        <AnimatePresence>
          {flow.sessionStartFlash && (
            <motion.div
              initial={{ opacity: 0.6 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="fixed inset-0 z-[200] bg-text-main pointer-events-none"
            />
          )}
        </AnimatePresence>

        <PasswordPromptModal 
          isOpen={!!passwordPrompt}
          onConfirm={handlePromptSubmit}
          onCancel={handlePromptCancel}
        />

        <CancelConfirmModal 
          isOpen={flow.showCancelConfirm}
          onConfirm={() => { handleCancel(); flow.setShowCancelConfirm(false); }}
          onCancel={() => flow.setShowCancelConfirm(false)}
        />

        <WritingFinishModal 
          isOpen={sessionStatus === 'finished'}
          onClose={() => useWritingStore.getState().finishSession()}
          onConfirm={() => { hookHandleSave(isLocalOnly); }}
          title={title} setTitle={setTitle}
          sessionType={sessionType} wordCount={wordCount} duration={seconds}
          isPublic={isPublic} setIsPublic={setIsPublic}
          isAnonymous={isAnonymous} setIsAnonymous={setIsAnonymous}
          handleSave={(localOnly?: boolean) => hookHandleSave(localOnly ?? isLocalOnly)}
          tags={tags} setTags={setTags}
          labelId={labelId} setLabelId={setLabelId}
          labels={profile?.labels || []}
          isLocalOnly={isLocalOnly}
          existingDocuments={documents}
          onSaveAsNew={handleSaveAsNewDocument}
          onSaveAsVersion={handleSaveAsVersion}
        />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${showZen ? '0px' : 'auto'} 1fr ${lifeLogVisible ? `${LIFE_LOG_WIDTH}px` : '0px'}`,
            gridTemplateRows: '48px 1fr 64px',
            height: '100vh',
            width: '100vw',
            position: 'fixed',
            inset: 0,
            zIndex: 20,
            transition: 'grid-template-columns 0.25s cubic-bezier(.4,.2,.2,1)',
            overflow: 'hidden',
          }}
        >
          <div style={{ gridColumn: '1', gridRow: '1 / 4', overflow: 'hidden' }}>
            <Sidebar isAdmin={!!profile?.role && profile.role === 'admin'} inGrid />
          </div>

          <div style={{ gridColumn: '2', gridRow: '1', overflow: 'hidden' }}>
            <WritingHeader 
              handleNewSession={handleNewSession}
              fetchUserSessions={fetchAllSessions}
              loadingSessions={loadingSessions}
              hasDraft={hasDraft}
              onOpenSettings={openSettings}
              handlePause={handlePause}
              handleStart={handlePlay}
              handleFinish={handleFinish}
              setShowCancelConfirm={flow.setShowCancelConfirm}
              totalDurationForDeadline={flow.totalDurationForDeadline}
              onNew={handleNew}
              onOpenLog={handleOpen}
              onSave={handleSave}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
            />
          </div>

          <div ref={editorColRef} style={{
            gridColumn: '2',
            gridRow: '2',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
          }}>
            <div style={{
              width: editorWidth < 100 ? `${editorWidth}%` : '100%',
              height: '100%',
              position: 'relative',
            }}
            className={cn(
              editorWidth < 100 && "rounded-2xl m-2 border border-border-subtle/40 backdrop-blur-sm bg-text-main/[0.02] shadow-xl"
            )}
            >
              <WritingEditor 
                handlePause={() => setSessionStatus('paused')}
                handleStart={() => {
                  useWritingStore.getState().setSessionType('free');
                  useWritingStore.getState().setSessionStart();
                  hookHandleStart();
                }}
                handleFinish={handleFinish}
                setShowCancelConfirm={flow.setShowCancelConfirm}
                saveStatus={saveStatus}
                lastSavedAt={lastSavedAt}
                onKeyDown={(e) => {
                  if (sessionStatus === 'idle' && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
                    handlePlayRef.current();
                  } else if (sessionStatus === 'paused' && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
                    handlePlayRef.current();
                  }
                }}
              />
            </div>
          </div>

          <div style={{ gridColumn: '2', gridRow: '3', overflow: 'hidden' }}>
            <BottomStats
              compact={isCompact}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
            />
          </div>

          <div style={{ gridColumn: '3', gridRow: '1 / 4', overflow: 'hidden' }}>
            <AnimatePresence>
              {lifeLogVisible && (
                <LifeLogPanel 
                  userId={user.uid} 
                  onContinueSession={handleContinueSession} 
                  onClose={() => { if (!lifeLogPinned) setLifeLogVisible(false); }} 
                  activeTab={lifeLogTab}
                  onTabChange={setLifeLogTab}
                  pinned={lifeLogPinned}
                  onTogglePin={() => setLifeLogPinned(!lifeLogPinned)}
                  inGrid
                />
              )}
            </AnimatePresence>
          </div>
        </div>

        <FlowPulse />
      </>
    </motion.div>
  );
}

export function WritingPage({ user, profile }: WritingViewProps) {
  if (!user) return <GuestWritingPage />;
  return <WritingPageContent user={user} profile={profile} />;
}
