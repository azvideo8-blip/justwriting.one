import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { settingsTranslations } from '../../../shared/i18n/translations/settings';
import { TERMS } from '../../navigation/pages/legalContent';

describe('S-20: GDPR JSON button and guide promise only notes, not all data', () => {
  it('settings_export_json_button does not promise all data and says Скачать заметки в JSON (GDPR)', () => {
    const ru = settingsTranslations.settings_export_json_button!.ru;
    expect(ru).not.toMatch(/всех своих данных/);
    expect(ru).toBe('Скачать заметки в JSON (GDPR)');
  });

  it('backup.html does not contain justwriting-export and reflects justwriting-backup', () => {
    const backupHtmlPath = path.resolve(__dirname, '../../../../public/docs/backup.html');
    const html = fs.readFileSync(backupHtmlPath, 'utf8');
    expect(html).not.toContain('justwriting-export');
    expect(html).toContain('justwriting-backup');
  });

  it('legal terms mention полная выгрузка данных этого устройства', () => {
    const ruTerms = TERMS.ru.sections.find(s => s.title.includes('Ответственность'));
    expect(ruTerms).toBeDefined();
    const para = ruTerms?.paragraphs.find(p => p.includes('выгрузка'));
    expect(para).toContain('полная выгрузка данных этого устройства');
  });
});
