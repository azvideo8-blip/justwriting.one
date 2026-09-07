import { describe, it, expect } from 'vitest';
import { settingsTranslations } from '../translations/settings';
import { aiTranslations } from '../translations/ai';
import { adminTranslations } from '../translations/admin';

describe('DUP-7: Confirmation dialogs i18n convergence', () => {
  const allTranslations = {
    ...settingsTranslations,
    ...aiTranslations,
    ...adminTranslations,
  };

  const dialogKeys = [
    // AccountAISection
    'settings_ai_withdraw_consent_title',
    'settings_ai_withdraw_consent_message',
    'settings_ai_withdraw_indexing_title',
    'settings_ai_withdraw_indexing_message',
    'settings_ai_clear_data_title',
    'settings_ai_clear_data_message',
    // PersonaDetailModal
    'ai_persona_delete_confirm_title',
    'ai_persona_delete_confirm_message',
    // DatabaseExplorer
    'admin_db_delete_confirm_title',
    'admin_db_delete_confirm_message',
    // EmbeddingDiagnostics
    'admin_embed_reindex_all_confirm_title',
    'admin_embed_reindex_all_confirm_message',
    // QueueExplorer
    'admin_queue_clear_confirm_title',
    'admin_queue_clear_confirm_message',
    // useAIPageData
    'ai_reasoning_mode_confirm_title',
    'ai_reasoning_mode_confirm_message',
    'ai_reasoning_mode_confirm_label',
    'ai_delete_message_confirm_title',
    'ai_delete_message_confirm_message',
    'ai_feedback_prompt_title',
    'ai_feedback_prompt_message',
    'ai_feedback_prompt_placeholder',
    // useAttachmentManager
    'ai_file_too_large_title',
    'ai_file_too_large_max_1mb',
    'ai_file_unsupported_title',
    'ai_file_unsupported_message',
    'ai_file_too_large_chars',
    // useDialogueManager
    'ai_delete_dialogue_confirm_title',
    'ai_delete_dialogue_confirm_message',
    // useSyncDiagnostics
    'admin_sync_unlink_confirm_title',
    'admin_sync_unlink_confirm_message',
    // useDiagnosticsData
    'admin_clear_memory_confirm_title',
    'admin_clear_memory_confirm_message',
    'admin_reset_user_limit_confirm_title',
    'admin_reset_user_limit_confirm_message',
  ];

  it('renders each dialog key in English with zero Cyrillic characters', () => {
    const cyrillicRegex = /[\u0400-\u04FF]/;

    for (const key of dialogKeys) {
      const entry = (allTranslations as Record<string, { ru: string; en: string }>)[key];
      expect(entry, `Key ${key} should be defined in translations`).toBeDefined();
      if (!entry) throw new Error(`Missing ${key}`);
      expect(entry.en, `Key ${key} should have English translation`).toBeDefined();
      expect(entry.en.length).toBeGreaterThan(0);
      expect(cyrillicRegex.test(entry.en), `Key ${key} English translation should not contain Cyrillic: "${entry.en}"`).toBe(false);
    }
  });

  it('renders each dialog key in Russian with valid non-empty content', () => {
    for (const key of dialogKeys) {
      const entry = (allTranslations as Record<string, { ru: string; en: string }>)[key];
      expect(entry, `Key ${key} should be defined in translations`).toBeDefined();
      if (!entry) throw new Error(`Missing ${key}`);
      expect(entry.ru, `Key ${key} should have Russian translation`).toBeDefined();
      expect(entry.ru.length).toBeGreaterThan(0);
    }
  });

  it('falsification: audit regex catches hardcoded inline Cyrillic inside confirmDialog, alertDialog, and promptDialog', () => {
    const snippetWithCyrillic = `
      const ok = await confirmDialog({
        title: 'Удалить диалог?',
        message: 'Действие необратимо.',
      });
      void alertDialog({ title: 'Ошибка', message: \`Допустимы: \${allowedExts.join(', ')}\` });
      const res = await promptDialog({ title: 'Вопрос', message: 'Введите ответ' });
    `;

    const snippetWithoutCyrillic = `
      const ok = await confirmDialog({
        title: t('ai_delete_dialogue_confirm_title'),
        message: t('ai_delete_dialogue_confirm_message'),
      });
      void alertDialog({ title: t('ai_file_too_large_title'), message: t('ai_file_too_large_max_1mb') });
      const res = await promptDialog({ title: t('ai_feedback_prompt_title'), message: t('ai_feedback_prompt_message') });
    `;

    const detectHardcoded = (src: string) => {
      const dialogPattern = /\b(confirmDialog|alertDialog|promptDialog)\s*\(/g;
      let match: RegExpExecArray | null;
      while ((match = dialogPattern.exec(src)) !== null) {
        const startIndex = match.index + match[0].length;
        let depth = 1;
        let i = startIndex;
        let inString: string | null = null;
        let isEscaped = false;
        while (i < src.length && depth > 0) {
          const ch = src[i];
          if (inString) {
            if (isEscaped) isEscaped = false;
            else if (ch === '\\\\') isEscaped = true;
            else if (ch === inString) inString = null;
          } else {
            if (ch === "'" || ch === '"' || ch === '`') inString = ch;
            else if (ch === '(') depth++;
            else if (ch === ')') depth--;
          }
          i++;
        }
        const callContent = src.slice(startIndex, i - 1);
        if (/[\u0400-\u04FF]/.test(callContent)) return true;
      }
      return false;
    };

    expect(detectHardcoded(snippetWithCyrillic)).toBe(true);
    expect(detectHardcoded(snippetWithoutCyrillic)).toBe(false);
  });
});
