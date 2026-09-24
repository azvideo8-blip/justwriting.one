import { describe, it, expect } from 'vitest';
import { settingsTranslations } from '../translations/settings';
import { aiTranslations } from '../translations/ai';
import { adminTranslations } from '../translations/admin';

import { findHardcodedDialogs } from '../../../../scripts/i18n-audit';

describe('DUP-7 / WT-3: Confirmation dialogs i18n convergence and audit detector', () => {
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

  // D-7: окно включало рассуждения цифрами, которых нет: «5 (вместо 10)», хотя
  // обычный лимит чата — 30, а рассуждения — отдельный счётчик. Число теперь
  // подставляется из useAiLimitStore.reasoningLimit параметром {limit}.
  it('reasoning-mode confirm states the limit via {limit}, not hardcoded numbers (D-7)', () => {
    const entry = aiTranslations.ai_reasoning_mode_confirm_message;
    expect(entry).toBeDefined();
    for (const lang of ['ru', 'en'] as const) {
      const text = entry![lang];
      expect(text).toContain('{limit}');
      // Ни одной цифры в самом тексте — источник числа только store.
      expect(text).not.toMatch(/\d/);
      // Прежняя формулировка утверждала, что рассуждения заменяют обычный лимит.
      expect(text).not.toMatch(/вместо|instead of/i);
    }
  });

  it('findHardcodedDialogs finds Russian text in confirmDialog, alertDialog, and promptDialog', () => {
    const snippetWithCyrillic = `
      const ok = await confirmDialog({
        title: 'Удалить диалог?',
        message: 'Действие необратимо.',
      });
      void alertDialog({ title: 'Ошибка', message: \`Допустимы: \${allowedExts.join(', ')}\` });
      const res = await promptDialog({ title: 'Вопрос', message: 'Введите ответ' });
    `;

    const results = findHardcodedDialogs(snippetWithCyrillic, 'test.ts');
    expect(results).toHaveLength(3);
    expect(results[0]?.match).toContain('confirmDialog');
    expect(results[1]?.match).toContain('alertDialog');
    expect(results[2]?.match).toContain('promptDialog');
  });

  it('findHardcodedDialogs does not flag Russian translations referenced via t(...)', () => {
    const snippetWithoutCyrillic = `
      const ok = await confirmDialog({
        title: t('ai_delete_dialogue_confirm_title'),
        message: t('ai_delete_dialogue_confirm_message'),
      });
      void alertDialog({ title: t('ai_file_too_large_title'), message: t('ai_file_too_large_max_1mb') });
      const res = await promptDialog({ title: t('ai_feedback_prompt_title'), message: t('ai_feedback_prompt_message') });
    `;

    const results = findHardcodedDialogs(snippetWithoutCyrillic, 'test.ts');
    expect(results).toHaveLength(0);
  });

  it('findHardcodedDialogs handles nested brackets: confirmDialog({ title: t("a"), onConfirm: () => foo("б") })', () => {
    const nestedSnippet = `
      await confirmDialog({
        title: t('a'),
        onConfirm: () => foo('б'),
      });
    `;

    const results = findHardcodedDialogs(nestedSnippet, 'test.ts');
    expect(results).toHaveLength(1);
    expect(results[0]?.match).toContain("foo('б')");
  });

  it('findHardcodedDialogs handles string with ) inside quotes without truncating: confirmDialog({ title: "привет ) мир" })', () => {
    const quoteSnippet = `
      await confirmDialog({
        title: "привет ) мир",
      });
    `;

    const results = findHardcodedDialogs(quoteSnippet, 'test.ts');
    expect(results).toHaveLength(1);
    expect(results[0]?.match).toContain('мир');
  });

  it('findHardcodedDialogs ignores Cyrillic text in single-line and multi-line comments', () => {
    const commentSnippet = `
      await confirmDialog({
        title: t('ai_reasoning_mode_confirm_title'),
        // D-7: число берётся из того же лимита, который действительно действует
        /* многострочный комментарий на русском:
           проверка лимита */
        message: t('ai_reasoning_mode_confirm_message'),
      });
    `;

    const results = findHardcodedDialogs(commentSnippet, 'test.ts');
    expect(results).toHaveLength(0);
  });
});
