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

  it('falsification: audit regex catches hardcoded inline Cyrillic inside confirmDialog', () => {
    const snippetWithCyrillic = `
      const ok = await confirmDialog({
        title: 'Удалить диалог?',
        message: 'Действие необратимо.',
      });
    `;

    const snippetWithoutCyrillic = `
      const ok = await confirmDialog({
        title: t('ai_delete_dialogue_confirm_title'),
        message: t('ai_delete_dialogue_confirm_message'),
      });
    `;

    const detectHardcoded = (code: string) => {
      const matches = [...code.matchAll(/confirmDialog\s*\(\s*\{([^)]*?)\}\s*\)/gs)];
      return matches.some(m => /[\u0400-\u04FF]/.test(m[1] ?? ''));
    };

    expect(detectHardcoded(snippetWithCyrillic)).toBe(true);
    expect(detectHardcoded(snippetWithoutCyrillic)).toBe(false);
  });
});
