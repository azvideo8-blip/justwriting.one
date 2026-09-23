import React, { useState } from 'react';
import { Sparkles, CheckCircle2, XCircle, Trash2, Search, Database, UserRound, Lightbulb } from 'lucide-react';
import { useProfile } from '../../auth/contexts/ProfileContext';
import { DataProvider } from '../../../core/data';
import { setAiConsent } from '../../../core/ai/aiConsent';
import { getIndexingConsent, setIndexingConsent, INDEXING_CONSENT_VERSION } from '../../../core/ai/indexingConsent';
import { getSendPortraitInDialogue, setSendPortraitInDialogue } from '../../../core/ai/portraitDialoguePreference';
import { getChatExtrasEnabled, setChatExtrasEnabled } from '../../../core/ai/chatExtrasPreference';
import { Toggle } from '../../../shared/components/Toggle';
import { emitDomainEvent } from '../../../core/events/domainEvents';
import { PRIVACY_VERSION, AI_CONSENT_VERSION_REQUIRED } from '../../../core/constants/privacyVersion';
import { useToast } from '../../../shared/components/Toast';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { getLocalDb } from '../../../core/storage/localDb';
import { reportError } from '../../../shared/errors/reportError';
import { Section } from './SettingsHelpers';
import { Button } from '../../../shared/components/Button';
import { useLanguage } from '../../../shared/i18n';
import { SUPPORTED_LOCAL_STORES } from '../../../core/services/LocalStoreSyncService';
import { writeFacetStore } from '../../../core/services/facetLock';

interface AccountAISectionProps {
  userId: string;
  onIndexPending?: (userId: string) => Promise<number>;
}

export function AccountAISection({ userId, onIndexPending }: AccountAISectionProps) {
  const { t } = useLanguage();
  const { profile } = useProfile();
  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirmDialog();
  const [loading, setLoading] = useState(false);
  const [indexingLoading, setIndexingLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Local preference, not server state: no network call, cannot fail, so no
  // loading/error state — the store update and the render are one click.
  const [sendPortrait, setSendPortraitState] = useState(() => getSendPortraitInDialogue(userId));
  const [chatExtras, setChatExtrasState] = useState(() => getChatExtrasEnabled(userId));
  const handleToggleChatExtras = (next: boolean) => {
    setChatExtrasEnabled(userId, next);
    setChatExtrasState(next);
  };

  const handleTogglePortrait = (next: boolean) => {
    setSendPortraitInDialogue(userId, next);
    setSendPortraitState(next);
  };

  const hasConsent = Boolean(
    profile?.aiConsentAt != null &&
    typeof profile?.aiConsentVersion === 'number' &&
    profile.aiConsentVersion >= AI_CONSENT_VERSION_REQUIRED
  );

  const indexingConsentState = getIndexingConsent(userId);

  const handleGrantConsent = async () => {
    setLoading(true);
    try {
      const now = new Date();
      await DataProvider.updateProfile(userId, {
        aiConsentAt: now,
        aiConsentVersion: PRIVACY_VERSION,
      });
      setAiConsent(userId, true);
      showToast(t('settings_ai_consent_granted'), 'success');
    } catch (e) {
      reportError(e, { action: 'grantAiConsent', userId });
      showToast(t('settings_ai_consent_grant_failed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawConsent = async () => {
    const ok = await confirmDialog({
      title: t('settings_ai_withdraw_consent_title'),
      message: t('settings_ai_withdraw_consent_message'),
    });
    if (!ok) return;

    setLoading(true);
    try {
      await DataProvider.updateProfile(userId, {
        aiConsentAt: null,
        aiConsentVersion: null,
      });
      setAiConsent(userId, false);
      showToast(t('settings_ai_consent_withdrawn'));
    } catch (e) {
      reportError(e, { action: 'withdrawAiConsent', userId });
      showToast(t('settings_ai_consent_withdraw_failed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGrantIndexingConsent = async () => {
    setIndexingLoading(true);
    try {
      const now = new Date();
      await DataProvider.updateProfile(userId, {
        indexingConsentAt: now,
        indexingConsentVersion: INDEXING_CONSENT_VERSION,
      });
      setIndexingConsent(userId, 'granted');
      showToast(t('settings_ai_indexing_granted'), 'success');
      if (onIndexPending) {
        void onIndexPending(userId);
      } else {
        emitDomainEvent({ type: 'ai.indexPending', userId });
      }
    } catch (e) {
      reportError(e, { action: 'grantIndexingConsent', userId });
      showToast(t('settings_ai_indexing_grant_failed'), 'error');
    } finally {
      setIndexingLoading(false);
    }
  };

  const handleWithdrawIndexingConsent = async () => {
    const ok = await confirmDialog({
      title: t('settings_ai_withdraw_indexing_title'),
      message: t('settings_ai_withdraw_indexing_message'),
    });
    if (!ok) return;

    setIndexingLoading(true);
    try {
      await DataProvider.updateProfile(userId, {
        indexingConsentAt: null,
        indexingConsentVersion: null,
      });
      setIndexingConsent(userId, 'refused');
      showToast(t('settings_ai_indexing_withdrawn'));
    } catch (e) {
      reportError(e, { action: 'withdrawIndexingConsent', userId });
      showToast(t('settings_ai_indexing_withdraw_failed'), 'error');
    } finally {
      setIndexingLoading(false);
    }
  };

  const handleClearAiData = async () => {
    const ok = await confirmDialog({
      title: t('settings_ai_clear_data_title'),
      message: t('settings_ai_clear_data_message'),
    });
    if (!ok) return;

    setClearing(true);
    try {
      // 1. Server-side deletes FIRST (S-16): embeddings, summaries, mirrored local stores, and profile portrait
      await DataProvider.deleteAllEmbeddings(userId);
      await DataProvider.deleteAllSummaries(userId);
      await DataProvider.deleteLocalStoreRecordsByStores(userId, [...SUPPORTED_LOCAL_STORES]);
      await DataProvider.updateProfile(userId, {
        aiPortrait: null,
      });

      // 2. Local IndexedDB deletes SECOND
      const db = await getLocalDb();
      const aiStores = Array.from(db.objectStoreNames).filter(
        name => name.startsWith('ai') || name === 'lifeStory',
      );
      for (const store of aiStores) {
        if (store === 'aiProfileFacets') {
          await writeFacetStore(s => s.clear());
        } else {
          await db.clear(store);
        }
      }

      // Reset aiProcessed on local documents
      const allDocs = await db.getAll('documents');
      for (const doc of allDocs) {
        if (doc.aiProcessed) {
          await db.put('documents', { ...doc, aiProcessed: false });
        }
      }

      showToast(t('settings_ai_data_cleared'), 'success');
    } catch (e) {
      reportError(e, { action: 'clearAiData', userId });
      showToast(t('settings_ai_data_clear_failed'), 'error');
    } finally {
      setClearing(false);
    }
  };

  return (
    <Section title="Искусственный интеллект и приватность">
      <div className="space-y-4">
        {/* Main AI Consent Card */}
        <div className="p-4 rounded-xl border border-border-subtle space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-brand-soft" />
              <span className="text-sm font-medium text-text-main">
                Согласие на использование ИИ
              </span>
            </div>
            {hasConsent ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent-success bg-accent-success/10 px-2.5 py-1 rounded-full border border-accent-success/20">
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

        {/* Indexing Consent Card (D4.27) */}
        <div className="p-4 rounded-xl border border-border-subtle space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-brand-soft" />
              <span className="text-sm font-medium text-text-main">
                Поиск по смыслу (векторная индексация)
              </span>
            </div>
            {indexingConsentState === 'granted' ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent-success bg-accent-success/10 px-2.5 py-1 rounded-full border border-accent-success/20">
                <CheckCircle2 size={12} />
                Включено
              </span>
            ) : indexingConsentState === 'refused' ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-text-main/60 bg-surface-base/10 px-2.5 py-1 rounded-full border border-border-subtle">
                <Search size={12} />
                Только по словам
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent-warning bg-accent-warning/10 px-2.5 py-1 rounded-full border border-accent-warning/20">
                <XCircle size={12} />
                Не выбрано
              </span>
            )}
          </div>

          <p className="text-xs text-text-main/60 leading-relaxed">
            Для поиска по смыслу (семантического поиска), связывания мыслей и подбора заметок в диалогах фрагменты текста отправляются поставщику ИИ для построения числового вектора (эмбеддинга). Векторы хранятся на устройстве в зашифрованном виде.
          </p>
          <p className="text-xs text-text-main/50 leading-relaxed">
            При отключении поиск работает по точным совпадениям слов (BM25), а разбор заметок, хронология и журнал тем продолжают работать без ограничений. Существующие индексы сохраняются на устройстве.
          </p>

          <div className="flex flex-wrap gap-2 pt-1 border-t border-border-subtle">
            {indexingConsentState === 'granted' ? (
              <Button
                onClick={() => void handleWithdrawIndexingConsent()}
                disabled={indexingLoading}
                className="py-2 px-3 rounded-xl border border-border-subtle text-xs text-text-main/70 hover:text-accent-danger hover:border-accent-danger/30 transition-colors"
              >
                Отключить (искать только по словам)
              </Button>
            ) : (
              <Button
                onClick={() => void handleGrantIndexingConsent()}
                disabled={indexingLoading}
                className="py-2 px-3 rounded-xl bg-brand-soft text-white text-xs font-medium hover:bg-brand-soft-hover transition-colors"
              >
                Включить поиск по смыслу
              </Button>
            )}
          </div>
        </div>

        {/* Portrait-in-dialogue preference — backlog "de-personalised portrait" shape 1 */}
        <div className="p-4 rounded-xl border border-border-subtle space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <UserRound size={16} className="text-brand-soft" />
              <span className="text-sm font-medium text-text-main">
                Портрет в диалоге
              </span>
            </div>
            <Toggle
              checked={sendPortrait}
              onChange={handleTogglePortrait}
              ariaLabel="Отправлять портрет в диалог"
            />
          </div>

          <p className="text-xs text-text-main/60 leading-relaxed">
            Портрет — то, что ИИ понял о вас из заметок — сейчас уходит поставщику
            вместе с каждым сообщением в чате, чтобы ответы были точнее. Здесь
            можно отключить это для диалога, не трогая сам портрет и разбор
            заметок — они продолжат работать как прежде.
          </p>
        </div>

        {/* EA-18: служебные запросы после сообщения в чате */}
        <div className="p-4 rounded-xl border border-border-subtle space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Lightbulb size={16} className="text-brand-soft" />
              <span className="text-sm font-medium text-text-main">
                Память ИИ и подсказки
              </span>
            </div>
            <Toggle
              checked={chatExtras}
              onChange={handleToggleChatExtras}
              ariaLabel="Память ИИ и подсказки"
            />
          </div>
          <p className="text-xs text-text-main/60 leading-relaxed">
            После ответа в чате приложение само делает служебные запросы с тем же
            разговором: предлагает варианты следующего сообщения и раз в несколько
            сообщений сохраняет факты в «Память ИИ». Выключите — и после ответа
            ничего дополнительно не отправляется (название диалога по-прежнему
            придумывается один раз).
          </p>
        </div>
      </div>
    </Section>
  );
}
