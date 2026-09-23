import { describe, it, expect } from 'vitest';
import { commonTranslations } from '../translations/common';

describe('D-17: Help page discrepancy fixes', () => {
  it('states that email is shown at the top of Settings in Account section', () => {
    const entry = commonTranslations.help_notes_missing_q1_hint;
    expect(entry).toBeDefined();
    expect(entry!.ru).toContain('Вверху страницы Настроек (раздел «Аккаунт»)');
    expect(entry!.ru).not.toContain('Внизу страницы Настроек');
    expect(entry!.en).toContain('at the top of Settings (Account section)');
    expect(entry!.en).not.toContain('at the bottom of Settings');
  });

  it('names cloud switch as "Автосинхронизация с облаком"', () => {
    const entry = commonTranslations.help_notes_missing_leaf_device;
    expect(entry).toBeDefined();
    expect(entry!.ru).toContain('«Автосинхронизация с облаком»');
    expect(entry!.ru).not.toMatch(/включено «Облако»/);
    expect(entry!.en).toContain('Cloud auto-sync');
  });

  it('references notes filters as "в меню «Заметки»"', () => {
    const entry = commonTranslations.help_notes_missing_leaf_filters;
    expect(entry).toBeDefined();
    expect(entry!.ru).toContain('в меню «Заметки»');
    expect(entry!.ru).not.toContain('в разделе «Архив»');
    expect(entry!.en).toContain('"Notes" menu');
    expect(entry!.en).not.toContain('in "Archive"');
  });
});
