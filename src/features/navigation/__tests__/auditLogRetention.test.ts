import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRIVACY_POLICY } from '../pages/legalContent';

// S-27: срок хранения журнала входов заявлен в политике и совпадает с тем, что
// исполняется на сервере (justwriting-audit-retention.*).

const DEPLOY = resolve(__dirname, '../../../../deploy');

const periods = (doc: { title: string; paragraphs: string[] }[]) =>
  doc.find(s => /Сроки хранения|Retention/.test(s.title))?.paragraphs.join(' ') ?? '';

describe('S-27: auth-log retention is stated, not just «ограниченное время»', () => {
  it('RU policy names 30 days for the sign-in log and immediate removal with the account', () => {
    const ru = periods(PRIVACY_POLICY.ru.sections);
    expect(ru).toMatch(/Журнал входов.*30 дней/s);
    expect(ru).toContain('записи удалённой учётной записи удаляются сразу');
    expect(ru).toContain('Журналы веб-сервера хранятся ограниченное время');
  });

  it('EN policy carries the same period', () => {
    const en = periods(PRIVACY_POLICY.en.sections);
    expect(en).toMatch(/sign-in log.*30 days/s);
    expect(en).toMatch(/deleted account.*immediately/s);
  });

  it('the document is dated after the retention change', () => {
    expect(PRIVACY_POLICY.ru.updated).toBe('1 октября 2026');
    expect(PRIVACY_POLICY.en.updated).toBe('October 1, 2026');
  });

  it('the repo ships the units prod runs, with the 30-day delete the policy promises', () => {
    const svc = readFileSync(resolve(DEPLOY, 'backup/justwriting-audit-retention.service'), 'utf8');
    const timer = readFileSync(resolve(DEPLOY, 'backup/justwriting-audit-retention.timer'), 'utf8');
    expect(svc).toContain('auth.audit_log_entries');
    expect(svc).toContain("interval '30 days'");
    expect(svc).toContain('ON_ERROR_STOP=1');
    expect(timer).toContain('OnCalendar=*-*-* 04:20:00');
    expect(timer).toContain('Persistent=true');
  });

  it('the S-7 failed-unit mask covers the retention unit', () => {
    expect(readFileSync(resolve(DEPLOY, 'monitor/healthcheck.py'), 'utf8')).toContain('justwriting*.service');
  });
});
