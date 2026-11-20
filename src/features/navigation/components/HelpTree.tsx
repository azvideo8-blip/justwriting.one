import React, { useState, useEffect } from 'react';
import { ArrowLeft, RotateCcw, Link as LinkIcon, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';

export interface HelpTreeAnswer {
  labelKey: string;
  next?: HelpTreeNode;
  leafKey?: string;
}

export interface HelpTreeNode {
  id: string;
  questionKey: string;
  questionHintKey?: string;
  answers: HelpTreeAnswer[];
}

export const NOTES_MISSING_TREE: HelpTreeNode = {
  id: 'help-notes-missing-1',
  questionKey: 'help_notes_missing_q1',
  questionHintKey: 'help_notes_missing_q1_hint',
  answers: [
    {
      labelKey: 'help_notes_missing_a1_no',
      leafKey: 'help_notes_missing_leaf_account',
    },
    {
      labelKey: 'help_ans_yes',
      next: {
        id: 'help-notes-missing-2',
        questionKey: 'help_notes_missing_q2',
        answers: [
          {
            labelKey: 'help_ans_no',
            leafKey: 'help_notes_missing_leaf_device',
          },
          {
            labelKey: 'help_ans_yes',
            next: {
              id: 'help-notes-missing-3',
              questionKey: 'help_notes_missing_q3',
              answers: [
                {
                  labelKey: 'help_ans_yes',
                  leafKey: 'help_notes_missing_leaf_cache',
                },
                {
                  labelKey: 'help_ans_no',
                  leafKey: 'help_notes_missing_leaf_filters',
                },
              ],
            },
          },
        ],
      },
    },
  ],
};

export function findPathToNode(node: HelpTreeNode, targetId: string): HelpTreeNode[] | null {
  if (node.id === targetId) return [node];
  for (const ans of node.answers) {
    if (ans.next) {
      const sub = findPathToNode(ans.next, targetId);
      if (sub) return [node, ...sub];
    }
  }
  return null;
}

function updateHash(hash: string) {
  window.location.hash = hash;
}

interface HelpTreeProps {
  tree?: HelpTreeNode;
}

export function HelpTree({ tree = NOTES_MISSING_TREE }: HelpTreeProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [path, setPath] = useState<HelpTreeNode[]>([tree]);
  const [activeLeafKey, setActiveLeafKey] = useState<string | null>(null);

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace(/^#/, '');
      if (hash) {
        const matched = findPathToNode(tree, hash);
        if (matched) {
          setPath(matched);
          setActiveLeafKey(null);
          return;
        }
      }
      setPath([tree]);
      setActiveLeafKey(null);
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [tree]);

  const currentNode = path[path.length - 1] ?? tree;

  const handleSelectAnswer = (ans: HelpTreeAnswer) => {
    if (ans.leafKey) {
      setActiveLeafKey(ans.leafKey);
    } else if (ans.next) {
      updateHash(ans.next.id);
    }
  };

  const handleBack = () => {
    if (activeLeafKey) {
      setActiveLeafKey(null);
      return;
    }
    if (path.length > 1) {
      const prev = path[path.length - 2];
      if (prev) {
        updateHash(prev.id);
      }
    }
  };

  const handleRestart = () => {
    setActiveLeafKey(null);
    updateHash(tree.id);
  };

  const handleCopyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${currentNode.id}`;
    // «Скопирована» — только когда буфер принял ссылку; нет буфера или отказ — ошибка.
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      showToast(t('archive_copy_failed'), 'error');
      return;
    }
    showToast(t('help_link_copied'), 'success');
  };

  return (
    <div className="bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono uppercase tracking-wider text-text-main/50">
          {t('help_step_indicator', { step: String(path.length), total: '3' })}
        </span>
        <IconButton
          onClick={() => void handleCopyLink()}
          className="p-1.5 rounded-lg text-text-main/60 hover:text-text-main hover:bg-surface-base/10 transition-colors shrink-0"
          label={t('help_copy_link')}
          icon={<LinkIcon size={14} />}
        />
      </div>

      <div className="space-y-1.5">
        <h3 className="text-base font-semibold text-text-main leading-snug">
          {t(currentNode.questionKey)}
        </h3>
        {currentNode.questionHintKey && (
          <p className="text-xs text-text-main/60 leading-relaxed">
            {t(currentNode.questionHintKey)}
          </p>
        )}
      </div>

      {activeLeafKey ? (
        <div className="p-4 rounded-xl bg-surface-base/10 border border-border-subtle space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <CheckCircle2 size={16} className="text-accent-success shrink-0" />
            <span>{t('help_solution_title')}</span>
          </div>
          <p className="text-sm text-text-main/80 leading-relaxed">
            {t(activeLeafKey)}
          </p>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
          {currentNode.answers.map((ans, idx) => (
            <Button
              key={idx}
              onClick={() => handleSelectAnswer(ans)}
              className="flex-1 py-3 px-4 rounded-xl border border-border-subtle hover:border-text-main/30 text-sm font-medium hover:bg-surface-base/10 transition-colors text-center cursor-pointer"
            >
              {t(ans.labelKey)}
            </Button>
          ))}
        </div>
      )}

      {(path.length > 1 || activeLeafKey) && (
        <div className="flex items-center justify-between pt-3 border-t border-border-subtle/50 text-xs">
          <Button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-text-main/60 hover:text-text-main transition-colors py-1.5 px-2.5 rounded-lg"
          >
            <ArrowLeft size={14} />
            {t('help_btn_back')}
          </Button>
          <Button
            onClick={handleRestart}
            className="flex items-center gap-1.5 text-text-main/60 hover:text-text-main transition-colors py-1.5 px-2.5 rounded-lg"
          >
            <RotateCcw size={14} />
            {t('help_btn_restart')}
          </Button>
        </div>
      )}
    </div>
  );
}
