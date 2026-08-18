import React, { useState } from 'react';
import { Sparkles, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { useProfile } from '../../auth/contexts/ProfileContext';
import { DataProvider } from '../../../core/data';
import { setAiConsent } from '../../../core/ai/aiConsent';
import { PRIVACY_VERSION } from '../../auth/components/PrivacyModal';
import { useToast } from '../../../shared/components/Toast';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { getLocalDb } from '../../../core/storage/localDb';
import { reportError } from '../../../shared/errors/reportError';
import { Section } from './SettingsHelpers';
import { Button } from '../../../shared/components/Button';

interface AccountAISectionProps {
  userId: string;
}

export function AccountAISection({ userId }: AccountAISectionProps) {
  const { profile } = useProfile();
  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirmDialog();
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const hasConsent = Boolean(
    profile?.aiConsentAt != null &&
    typeof profile?.aiConsentVersion === 'number' &&
    profile.aiConsentVersion >= PRIVACY_VERSION
  );

  const handleGrantConsent = async () => {
    setLoading(true);
    try {
      const now = new Date();
      await DataProvider.updateProfile(userId, {
        aiConsentAt: now,
        aiConsentVersion: PRIVACY_VERSION,
      });
      setAiConsent(userId, true);
      showToast('Согласие на использование ИИ предоставлено', 'success');
    } catch (e) {
      reportError(e, { action: 'grantAiConsent', userId });
      showToast('Не удалось сохранить согласие', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawConsent = async () => {
    const ok = await confirmDialog({
      title: 'Отозвать согласие на использование ИИ?',
      message: 'Запросы к ИИ (разбор заметок, чат, обновление профиля) перестанут выполняться до повторного согласия.',
    });
    if (!ok) return;

    setLoading(true);
    try {
      await DataProvider.updateProfile(userId, {
        aiConsentAt: null,
        aiConsentVersion: null,
      });
      setAiConsent(userId, false);
      showToast('Согласие на использование ИИ отозвано');
    } catch (e) {
      reportError(e, { action: 'withdrawAiConsent', userId });
      showToast('Не удалось отозвать согласие', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClearAiData = async () => {
    const ok = await confirmDialog({
      title: 'Удалить все данные ИИ?',
      message: 'Будут удалены все созданные ИИ сводки, темы, портрет, грани, история диалогов и векторные индексы. Сами заметки и их текст останутся в полной сохранности.',
    });
    if (!ok) return;

    setClearing(true);
    try {
      const db = await getLocalDb();
      // Список берётся из самой базы, а не переписывается руками: в прежней
      // редакции пять имён были выдуманы («aiMonthlyDigests», «aiThemes»,
      // «aiThemeConsolidation», «aiBeliefClaims», «aiBeliefContradictions»), а
      // девять настоящих хранилищ пропущены — портрет, убеждения, обязательства,
      // ветки, персоны, история жизни, реестр тем, журнал и месячные обзоры.
      // Кнопка сообщала бы об удалении данных ИИ, оставляя самое личное на месте.
      // Приведение к any это скрывало.
      const aiStores = Array.from(db.objectStoreNames).filter(
        name => name.startsWith('ai') || name === 'lifeStory',
      );
      for (const store of aiStores) {
        await db.clear(store);
      }

      // Reset aiProcessed on local documents
      const allDocs = await db.getAll('documents');
      for (const doc of allDocs) {
        if (doc.aiProcessed) {
          await db.put('documents', { ...doc, aiProcessed: false });
        }
      }

      // Clear cloud portrait
      await DataProvider.updateProfile(userId, {
        aiPortrait: null,
      });

      showToast('Все данные ИИ удалены', 'success');
    } catch (e) {
      reportError(e, { action: 'clearAiData', userId });
      showToast('Не удалось очистить данные ИИ', 'error');
    } finally {
      setClearing(false);
    }
  };

  return (
    <Section title="Искусственный интеллект и приватность">
      <div className="p-4 rounded-xl border border-border-subtle space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-brand-soft" />
            <span className="text-sm font-medium text-text-main">
              Согласие на использование ИИ
            </span>
          </div>
          {hasConsent ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-500 bg-green-500/10 px-2.5 py-1 rounded-full border border-green-500/20">
              <CheckCircle2 size={12} />
              Предоставлено
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-text-main/50 bg-surface-base/10 px-2.5 py-1 rounded-full border border-border-subtle">
              <XCircle size={12} />
              Не предоставлено
            </span>
          )}
        </div>

        <p className="text-xs text-text-main/60 leading-relaxed">
          ИИ анализирует ваши заметки, помогает искать по смыслу и поддерживает диалог.
          Запросы отправляются модели только при явном согласии и только для тех заметок, которые не скрыты от ИИ.
        </p>

        <div className="flex flex-wrap gap-2 pt-1 border-t border-border-subtle">
          {hasConsent ? (
            <Button
              onClick={() => void handleWithdrawConsent()}
              disabled={loading}
              className="py-2 px-3 rounded-xl border border-border-subtle text-xs text-text-main/70 hover:text-accent-danger hover:border-accent-danger/30 transition-colors"
            >
              Отозвать согласие
            </Button>
          ) : (
            <Button
              onClick={() => void handleGrantConsent()}
              disabled={loading}
              className="py-2 px-3 rounded-xl bg-brand-soft text-white text-xs font-medium hover:bg-brand-soft-hover transition-colors"
            >
              Предоставить согласие
            </Button>
          )}

          <Button
            onClick={() => void handleClearAiData()}
            disabled={clearing}
            className="py-2 px-3 rounded-xl border border-accent-danger/30 text-xs text-accent-danger hover:bg-accent-danger/10 transition-colors flex items-center gap-1.5 ml-auto"
          >
            <Trash2 size={13} />
            Удалить все данные ИИ
          </Button>
        </div>
      </div>
    </Section>
  );
}
