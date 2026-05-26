import { useState, useCallback, useRef, useEffect } from 'react';
import { Sparkles, Plus, Archive, Download, Trash2, FileText, Loader2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { AIDialogueService } from '../services/AIDialogueService';
import { AIPersonaService, PRESET_PERSONAS, PRESET_PERSONA_DESCRIPTIONS } from '../services/AIPersonaService';
import { useAIChat } from '../hooks/useAIChat';
import { useDailyLimit } from '../hooks/useDailyLimit';
import { DocumentPickerModal } from '../components/DocumentPickerModal';
import { CreatePersonaModal } from '../components/CreatePersonaModal';
import type { AIDialogue, AIPersona } from '../../../core/storage/localDb';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { cn } from '../../../core/utils/utils';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';

export function AIPage() {
  const { profile } = useAuthStatus();
  const isAdmin = profile?.role === 'admin';
  const [searchParams] = useSearchParams();
  const linkedDocId = searchParams.get('doc') ?? undefined;
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';

  const [dialogues, setDialogues] = useState<AIDialogue[]>([]);
  const [archivedDialogues, setArchivedDialogues] = useState<AIDialogue[]>([]);
  const [activeDialogueId, setActiveDialogueId] = useState<string | null>(null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('group_psychology');
  const [showArchived, setShowArchived] = useState(false);
  const [customPersonas, setCustomPersonas] = useState<AIPersona[]>([]);
  const [inputText, setInputText] = useState('');
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [createPersonaOpen, setCreatePersonaOpen] = useState(false);
  const [infoPersonaId, setInfoPersonaId] = useState<string | null>(null);
  const initRef = useRef(false);

  const dailyLimit = useDailyLimit();
  const {
    dialogue,
    isLoading,
    error,
    sendMessage,
    loadDocument,
    clearError,
    documentContent,
    documentMood,
  } = useAIChat(activeDialogueId, selectedPersonaId);

  const loadDialogues = useCallback(async () => {
    const [active, archived] = await Promise.all([
      AIDialogueService.list({ includeArchived: false }),
      AIDialogueService.list({ includeArchived: true }),
    ]);
    setDialogues(active);
    setArchivedDialogues(archived.filter(d => d.archivedAt));
  }, []);

  const loadCustomPersonas = useCallback(async () => {
    const list = await AIPersonaService.listCustom();
    setCustomPersonas(list);
  }, []);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    loadDialogues();
    loadCustomPersonas();
    if (linkedDocId) loadDocument(linkedDocId);
  }, [loadDialogues, loadCustomPersonas, linkedDocId, loadDocument]);

  useEffect(() => {
    if (infoPersonaId === null) return;
    const dismiss = () => setInfoPersonaId(null);
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [infoPersonaId]);

  const handleSendMessage = async () => {
    if (!inputText.trim() || isLoading) return;
    const text = inputText.trim();
    setInputText('');

    if (!activeDialogueId && !documentContent) {
      setDocPickerOpen(true);
      setInputText(text);
      return;
    }

    await sendMessage(text);
    if (!activeDialogueId && dialogue) {
      setActiveDialogueId(dialogue.id);
    }
    loadDialogues();
  };

  const handleNewDialogue = () => {
    setActiveDialogueId(null);
    setInputText('');
  };

  const handleArchive = async () => {
    if (activeDialogueId) {
      await AIDialogueService.archive(activeDialogueId);
      setActiveDialogueId(null);
      loadDialogues();
    }
  };

  const handleDelete = async () => {
    if (activeDialogueId) {
      await AIDialogueService.delete(activeDialogueId);
      setActiveDialogueId(null);
      loadDialogues();
    }
  };

  const handleExport = async () => {
    if (!activeDialogueId) return;
    const md = await AIDialogueService.exportAsMarkdown(activeDialogueId);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dialogue-${activeDialogueId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDocSelect = async (documentId: string) => {
    await loadDocument(documentId);
  };

  const allPersonas = [...PRESET_PERSONAS, ...customPersonas.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, isPreset: false as const }))];

  const activeDialogue = dialogue ?? dialogues.find(d => d.id === activeDialogueId) ?? null;
  const displayMessages = activeDialogue?.messages ?? [];

  return (
    <div className={cn("h-screen bg-surface-base flex", isMobile ? "flex-col" : "flex-row")}>
      {!isMobile && (
        <div className="w-[280px] border-r border-border-subtle flex flex-col bg-surface-card/50">
          <div className="p-4 border-b border-border-subtle">
            <button
              onClick={handleNewDialogue}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-soft/10 border border-brand-soft/20 text-brand-soft text-sm font-medium hover:bg-brand-soft/20 transition-colors"
            >
              <Plus size={16} />
              Новый диалог
            </button>
          </div>

          <div className="flex gap-1 px-3 pt-3">
            <button
              onClick={() => setShowArchived(false)}
              className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", !showArchived ? "bg-text-main/10 text-text-main" : "text-text-main/40 hover:text-text-main/60")}
            >
              Активные
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", showArchived ? "bg-text-main/10 text-text-main" : "text-text-main/40 hover:text-text-main/60")}
            >
              Архив
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {(showArchived ? archivedDialogues : dialogues).map(d => (
              <button
                key={d.id}
                onClick={() => { setActiveDialogueId(d.id); setSelectedPersonaId(d.personaId); }}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-xl transition-colors",
                  activeDialogueId === d.id ? "bg-text-main/10 text-text-main" : "text-text-main/60 hover:bg-text-main/5"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{d.personaEmoji}</span>
                  <span className="text-sm font-medium truncate flex-1">{d.title}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-mono text-text-main/25">{new Date(d.updatedAt).toLocaleDateString()}</span>
                  {d.documentId && <FileText size={10} className="text-text-main/20" />}
                </div>
              </button>
            ))}
            {((showArchived ? archivedDialogues : dialogues).length === 0) && (
              <div className="py-8 text-center text-xs text-text-main/25">
                {showArchived ? 'Нет архивных диалогов' : 'Нет активных диалогов'}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 pt-4 pb-2 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-brand-soft" />
              <h2 className="text-lg font-bold text-text-main">AI</h2>
            </div>
            <div className="flex items-center gap-1">
              {activeDialogueId && (
                <>
                  <button onClick={handleExport} className="p-2 rounded-lg text-text-main/40 hover:text-text-main transition-colors" title="Скачать .md">
                    <Download size={16} />
                  </button>
                  <button onClick={handleArchive} className="p-2 rounded-lg text-text-main/40 hover:text-text-main transition-colors" title="В архив">
                    <Archive size={16} />
                  </button>
                  <button onClick={handleDelete} className="p-2 rounded-lg text-text-main/30 hover:text-red-400 transition-colors" title="Удалить">
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 no-scrollbar">
            {allPersonas.map(p => (
              <div key={p.id} className="relative shrink-0">
                <button
                  onClick={() => setSelectedPersonaId(p.isPreset ? p.id : 'custom')}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                    (p.isPreset && selectedPersonaId === p.id) || (!p.isPreset && selectedPersonaId === 'custom')
                      ? "bg-brand-soft/10 border-brand-soft/30 text-brand-soft"
                      : "bg-text-main/3 border-border-subtle text-text-main/50 hover:text-text-main/70"
                  )}
                >
                  <span>{p.emoji}</span>
                  <span>{p.name}</span>
                </button>
                {p.isPreset && (
                  <>
                    <button
                      onClick={e => { e.stopPropagation(); setInfoPersonaId(infoPersonaId === p.id ? null : p.id); }}
                      className="absolute top-1 right-1 w-4 h-4 rounded-full text-[10px] text-text-main/30 hover:text-text-main/60 flex items-center justify-center"
                    >
                      i
                    </button>
                    {infoPersonaId === p.id && (
                      <div className="absolute bottom-full left-0 mb-1 w-48 p-2 rounded-xl bg-surface-card border border-border-subtle text-xs text-text-main/70 shadow-lg z-10">
                        {PRESET_PERSONA_DESCRIPTIONS[p.id] ?? p.name}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            <button
              onClick={() => setCreatePersonaOpen(true)}
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-border-subtle text-text-main/30 hover:text-text-main/50 transition-colors"
            >
              <Plus size={12} />
              Создать
            </button>
          </div>

          {!documentContent && !activeDialogueId && (
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => setDocPickerOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-text-main/5 border border-dashed border-border-subtle text-xs text-text-main/40 hover:text-text-main/60 transition-colors"
              >
                <FileText size={12} />
                Загрузить заметку
              </button>
            </div>
          )}
          {documentContent && (
            <div className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-soft/5 border border-brand-soft/15 text-xs text-brand-soft">
              <FileText size={12} />
              Заметка загружена
              {documentMood && <span className="ml-1">{documentMood}</span>}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {displayMessages.length === 0 && !activeDialogueId && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-brand-soft/10 flex items-center justify-center">
                <Sparkles size={28} className="text-brand-soft/50" />
              </div>
              <div>
                <p className="text-sm text-text-main/50">Начните диалог с ИИ</p>
                <p className="text-xs text-text-main/25 mt-1">Выберите персону и напишите сообщение</p>
              </div>
            </div>
          )}

          {displayMessages.map((msg, i) => (
            <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
                  msg.role === 'user'
                    ? "bg-brand-soft/10 text-text-main rounded-br-md"
                    : "bg-surface-card border border-border-subtle text-text-main/80 rounded-bl-md"
                )}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="px-4 py-2.5 rounded-2xl bg-surface-card border border-border-subtle rounded-bl-md">
                <Loader2 size={16} className="animate-spin text-brand-soft/50" />
              </div>
            </div>
          )}

          {error && (
            <div className="flex justify-center">
              <div className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                {error}
                <button onClick={clearError} className="ml-2 underline">Закрыть</button>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border-subtle">
          <div className="flex items-center gap-2">
            <input
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
              placeholder="Написать сообщение..."
              disabled={isLoading || (dailyLimit.remaining === 0 && !isAdmin)}
              className="flex-1 px-4 py-2.5 rounded-xl bg-text-main/5 border border-border-subtle text-sm text-text-main placeholder:text-text-main/30 outline-none focus:border-brand-soft/40 disabled:opacity-40"
            />
            <button
              onClick={handleSendMessage}
              disabled={isLoading || !inputText.trim() || (dailyLimit.remaining === 0 && !isAdmin)}
              className="px-4 py-2.5 rounded-xl bg-brand-soft text-surface-base text-sm font-medium disabled:opacity-40 transition-colors"
            >
              Отправить
            </button>
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] font-mono text-text-main/25">
              {isAdmin ? "Безлимитно для администратора" : `Осталось ${dailyLimit.remaining}/${dailyLimit.limit} сегодня`}
            </span>
          </div>
        </div>
      </div>

      {isMobile && (
        <div className="fixed bottom-16 left-0 right-0 z-40 bg-surface-card/85 backdrop-blur-xl border-t border-white/[0.06]">
          <div className="flex gap-1 overflow-x-auto px-3 py-2 no-scrollbar">
            {allPersonas.slice(0, 5).map(p => (
              <div key={p.id} className="relative shrink-0">
                <button
                  onClick={() => setSelectedPersonaId(p.isPreset ? p.id : 'custom')}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs",
                    selectedPersonaId === p.id ? "bg-brand-soft/10 text-brand-soft" : "text-text-main/40"
                  )}
                >
                  {p.emoji} {p.name}
                </button>
                {p.isPreset && (
                  <>
                    <button
                      onClick={e => { e.stopPropagation(); setInfoPersonaId(infoPersonaId === p.id ? null : p.id); }}
                      className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full text-[8px] text-text-main/30 hover:text-text-main/60 flex items-center justify-center"
                    >
                      i
                    </button>
                    {infoPersonaId === p.id && (
                      <div className="absolute bottom-full left-0 mb-1 w-44 p-2 rounded-xl bg-surface-card border border-border-subtle text-xs text-text-main/70 shadow-lg z-50">
                        {PRESET_PERSONA_DESCRIPTIONS[p.id] ?? p.name}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <DocumentPickerModal isOpen={docPickerOpen} onClose={() => setDocPickerOpen(false)} onSelect={handleDocSelect} />
      <CreatePersonaModal isOpen={createPersonaOpen} onClose={() => setCreatePersonaOpen(false)} onCreated={loadCustomPersonas} />
    </div>
  );
}
