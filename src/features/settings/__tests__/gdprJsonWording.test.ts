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

  // S-44.1: файлы называются по-разному (AccountExportSection: justwriting-export-… у
  // GDPR-выгрузки, justwriting-backup-… у полной) — руководство обязано говорить это,
  // а не «называется так же»; старое имя кнопки «Экспортировать в JSON (GDPR)» ушло.
  it('backup.html names both files correctly and uses the current GDPR button name', () => {
    const backupHtmlPath = path.resolve(__dirname, '../../../../public/docs/backup.html');
    const html = fs.readFileSync(backupHtmlPath, 'utf8');
    const fullExport = html.slice(html.indexOf('<h2 id="full-export">'), html.indexOf('<h2 id="full-import">'));
    expect(fullExport).toContain('Файл называется justwriting-backup');
    expect(fullExport).toContain('justwriting-export');
    expect(html).not.toContain('называется так же');
    expect(html).not.toContain('Экспортировать в JSON (GDPR)');
  });

  it('legal terms mention полная выгрузка данных этого устройства', () => {
    const ruTerms = TERMS.ru.sections.find(s => s.title.includes('Ответственность'));
    expect(ruTerms).toBeDefined();
    const para = ruTerms?.paragraphs.find(p => p.includes('выгрузка'));
    expect(para).toContain('полная выгрузка данных этого устройства');
  });
});
