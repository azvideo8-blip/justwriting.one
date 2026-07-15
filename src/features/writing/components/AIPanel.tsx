import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X, Copy, Check, Loader2, Wand2, Lightbulb, Tags, Smile, ArrowRight, AlignLeft, Highlighter, RotateCcw } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { AIService, type AIAction, type AIResult } from '../../../core/services/AIService';
import { useAiLimitStore } from '../../ai/store/useAiLimitStore';
import { useContentStore } from '../store/useContentStore';
import { IconButton } from '../../../shared/components/IconButton';
import { Button } from '../../../shared/components/Button';

const AI_ACTIONS: { action: AIAction; icon: React.ReactNode; labelKey: string }[] = [
  { action: 'shorten', icon: <AlignLeft size={14} />, labelKey: 'ai_action_shorten' },
  { action: 'accents', icon: <Highlighter size={14} />, labelKey: 'ai_action_accents' },
  { action: 'ideas', icon: <Lightbulb size={14} />, labelKey: 'ai_action_ideas' },
  { action: 'summarize', icon: <Wand2 size={14} />, labelKey: 'ai_action_summarize' },
  { action: 'tags', icon: <Tags size={14} />, labelKey: 'ai_action_tags' },
  { action: 'mood', icon: <Smile size={14} />, labelKey: 'ai_action_mood' },
  { action: 'continue', icon: <ArrowRight size={14} />, labelKey: 'ai_action_continue' },
];

interface AIPanelProps {
  open: boolean;
  onClose: () => void;
}

export function AIPanel({ open, onClose }: AIPanelProps) {
  const { t } = useLanguage();
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';
  const content = useContentStore(s => s.content);
  const setContent = useContentStore(s => s.setContent);
  const setTags = useContentStore(s => s.setTags);

  const [loading, setLoading] = useState(false);
  // Persist a result per action so switching between e.g. "Ideas" and "Summary"
  // keeps both — revisiting a cached action never re-spends a token.
  const [results, setResults] = useState<Partial<Record<AIAction, string>>>({});
  const [activeAction, setActiveAction] = useState<AIAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [appliedActions, setAppliedActions] = useState<Set<AIAction>>(new Set());

  const runAction = useCallback(async (action: AIAction, force: boolean) => {
    // Cache hit: show the stored result without calling the model again.
    if (!force && results[action] !== undefined) {
      setActiveAction(action);
      setError(null);
      return;
    }
    if (!navigator.onLine) {
      setError(t('ai_error_offline'));
      return;
    }
    if (!content.trim() || loading) return;

    const { remaining, useRequest: consumeRequest } = useAiLimitStore.getState();
    if (remaining <= 0) {
      setError(t('ai_error_rate_limit'));
      return;
    }

    setLoading(true);
    setActiveAction(action);
    setError(null);

    const res: AIResult = await AIService.process(content, action);

    if (res.ok) {
      setResults(prev => ({ ...prev, [action]: res.text }));
      setAppliedActions(prev => { const n = new Set(prev); n.delete(action); return n; });
      consumeRequest(); // count editor AI edits against the same daily limit as chat
    } else {
      const errorMap: Record<string, string> = {
        AUTH_REQUIRED: t('ai_error_auth'),
        DAILY_LIMIT: t('ai_error_rate_limit'),
        RATE_LIMIT: t('ai_error_rate_limit'),
        TOO_LONG: t('ai_error_too_long'),
        SERVER_ERROR: t('ai_error_server'),
      };
      setError(errorMap[(res as { ok: false; error: string }).error] ?? t('ai_error_server'));
    }
    setLoading(false);
  }, [content, loading, t, results]);

  const handleApply = useCallback(() => {
    if (!activeAction) return;
    const text = results[activeAction];
    if (!text) return;
    if (activeAction === 'tags') {
      const parsed = AIService.parseTags(text);
      if (parsed.length > 0) setTags(parsed);
    } else if (activeAction === 'continue') {
      // A continuation flows into the note directly.
      setContent(content.trimEnd() + '\n\n' + text);
    } else {
      // Everything else is appended below the existing text with a label —
      // never overwrites what the user wrote.
      const meta = AI_ACTIONS.find(a => a.action === activeAction);
      const label = `${meta ? t(meta.labelKey) : ''} ${t('ai_from_ai')}:`.trim();
      const base = content.trimEnd();
      setContent((base ? base + '\n\n' : '') + label + '\n' + text);
    }
    setAppliedActions(prev => new Set(prev).add(activeAction));
  }, [activeAction, results, content, setContent, setTags, t]);

  const handleCopy = useCallback(async () => {
    const text = activeAction ? results[activeAction] : undefined;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        setError(t('error_generic'));
      }
    }
  }, [activeAction, results, t]);

  const activeResult = activeAction ? results[activeAction] : undefined;
  const activeMeta = activeAction ? AI_ACTIONS.find(a => a.action === activeAction) : undefined;
  const isApplied = activeAction ? appliedActions.has(activeAction) : false;
  const canApply = Boolean(activeResult && activeAction && !isApplied);
  const hasContent = Boolean(content.trim());

  return (
    <AnimatePresence>
      {open && (
        <>
          {isMobile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-[var(--z-overlay)] bg-black/60 backdrop-blur-sm"
            />
          )}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t('ai_panel_title')}
            initial={isMobile ? { y: '100%' } : { opacity: 0, x: 20 }}
            animate={isMobile ? { y: 0 } : { opacity: 1, x: 0 }}
            exit={isMobile ? { y: '100%' } : { opacity: 0, x: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="fixed md:absolute bottom-0 md:bottom-2 left-0 md:left-auto right-0 md:right-2 top-auto md:top-2 h-[80vh] md:h-[calc(100%-16px)] w-full md:w-[340px] z-[var(--z-sheet)] md:z-50 flex flex-col rounded-t-[28px] md:rounded-2xl border-t md:border border-border-subtle/40 bg-surface-card/95 backdrop-blur-2xl shadow-2xl overflow-hidden"
          >
            {isMobile && (
              <div className="flex justify-center py-2 shrink-0">
                <div className="w-12 h-1.5 rounded-full bg-text-main/10" />
              </div>
            )}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle/40">
            <div className="flex items-center gap-2 text-text-main/70">
              <Sparkles size={16} className="text-brand-soft" />
              <span className="text-sm font-medium">{t('ai_panel_title')}</span>
            </div>
            <IconButton
              icon={<X size={14} />}
              label={t('ai_close')}
              size="sm"
              onClick={onClose}
              className="rounded-lg text-text-main/60 hover:text-text-main hover:bg-text-main/5"
            />
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
            {!hasContent && (
              <div className="text-xs text-text-main/60 text-center rounded-xl bg-text-main/[0.03] px-3 py-2.5 border border-border-subtle/30">
                {t('ai_no_content')}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {AI_ACTIONS.map(({ action, icon, labelKey }) => {
                const hasResult = results[action] !== undefined;
                const isActive = activeAction === action;
                const isBusy = loading && activeAction === action;
                return (
                  <Button
                    key={action}
                    variant="ghost"
                    size="sm"
                    onClick={() => void runAction(action, false)}
                    disabled={loading || !hasContent}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors",
                      isActive
                        ? "bg-brand-soft/15 text-brand-soft"
                        : "bg-text-main/[0.04] text-text-main/60 hover:bg-text-main/[0.08] hover:text-text-main/80",
                      (loading || !hasContent) && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {isBusy ? <Loader2 size={14} className="animate-spin" /> : icon}
                    <span className="flex-1 text-left truncate">{t(labelKey)}</span>
                    {hasResult && !isBusy && (
                      <Check size={11} className={cn("shrink-0", isActive ? "text-brand-soft" : "text-accent-success/70")} />
                    )}
                  </Button>
                );
              })}
            </div>

            <AnimatePresence mode="wait">
              <div aria-live="polite">
              {error && (
                <motion.div
                  role="alert"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-xs text-accent-danger/80 bg-accent-danger/10 rounded-xl px-3 py-2"
                >
                  {error}
                </motion.div>
              )}

              {activeResult && !loading && (
                <motion.div
                  key={activeAction}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-text-main/60 font-medium uppercase tracking-wider">
                      {activeMeta ? t(activeMeta.labelKey) : t('ai_result_label')}
                    </div>
                    <IconButton
                      icon={<RotateCcw size={12} />}
                      label={t('ai_result_label')}
                      size="sm"
                      onClick={() => { if (activeAction) void runAction(activeAction, true); }}
                      className="rounded-lg text-text-main/40 hover:text-text-main/70 hover:bg-text-main/5"
                    />
                  </div>
                  <div className="text-sm text-text-main/80 whitespace-pre-wrap leading-relaxed rounded-xl bg-text-main/[0.03] p-3 border border-border-subtle/30">
                    {activeResult}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleCopy()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-text-main/[0.05] text-text-main/60 hover:bg-text-main/[0.1] hover:text-text-main/80"
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      {copied ? t('ai_copied') : t('ai_copy')}
                    </Button>
                    {canApply && (
                      <Button
                        variant="brand"
                        size="sm"
                        onClick={handleApply}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-brand-soft/20 text-brand-soft hover:bg-brand-soft/30"
                      >
                        <Check size={12} />
                        {activeAction === 'tags' ? t('ai_apply_tags') : t('ai_apply')}
                      </Button>
                    )}
                    {isApplied && (
                      <span className="flex items-center gap-1 text-xs text-accent-success">
                        <Check size={12} />
                        {t('ai_applied')}
                      </span>
                    )}
                  </div>
                </motion.div>
              )}
              </div>
            </AnimatePresence>
          </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function AIToggleButton({ onClick, active }: { onClick: () => void; active: boolean }) {
  const { t } = useLanguage();
  return (
    <IconButton
      icon={<Sparkles size={16} />}
      label={t('ai_toggle')}
      onClick={onClick}
      active={active}
      className={cn(
        "rounded-lg",
        active
          ? "bg-brand-soft/20 text-brand-soft"
          : "text-text-main/60 hover:text-text-main hover:bg-text-main/5"
      )}
    />
  );
}
