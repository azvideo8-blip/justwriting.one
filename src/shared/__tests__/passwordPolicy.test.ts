// D-11: минимум длины пароля был разным в разных местах — «Сменить пароль»
// пропускал 6 символов, подсказка сейфа обещала 6, проверка требовала 8.
// Теперь одно число (src/shared/constants/passwordPolicy.ts) и подсказки в 8.
// Тест сканирует источники: нигде не осталось литеральных проверок длины
// пароля и нигде в текстах не обещано «6».
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { MIN_PASSWORD_LENGTH } from '../constants/passwordPolicy';

const ROOT = join(__dirname, '../..'); // src/

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('password length policy (D-11)', () => {
  it('the single constant is 8', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it('no password check compares against a literal number', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(ROOT)) {
      const src = readFileSync(file, 'utf8');
      // password/newPassword/vaultPassword.length < <литерал>
      const m = src.match(/\b\w*[Pp]assword\w*\.length\s*[<>]\s*\d+/g);
      for (const hit of m ?? []) {
        // локальная константа с литералом допустима только если это сам passwordPolicy
        if (file.endsWith('constants/passwordPolicy.ts')) continue;
        offenders.push(`${file}: ${hit}`);
      }
    }
    expect(offenders, `password length checks must use MIN_PASSWORD_LENGTH:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no UI text promises a six-character password', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(join(ROOT, 'shared/i18n/translations'))) {
      const src = readFileSync(file, 'utf8');
      if (/минимум\s*6|min(imum)?\s*6/i.test(src)) offenders.push(file);
    }
    expect(offenders, `подсказки про «минимум 6» больше нет: ${offenders.join(', ')}`).toEqual([]);
  });

  // D-28: поле создания сейфа — это пароль от аккаунта; правило длины живёт
  // в подсказке нового пароля (восстановление по коду).
  it('new-password hint says eight characters in both languages', () => {
    const ru = readFileSync(join(ROOT, 'shared/i18n/translations/common.ts'), 'utf8');
    const line = ru.split('\n').find(l => l.includes('enc_new_password_placeholder'));
    expect(line).toContain('8');
    expect(line).not.toMatch(/6/);
  });
});
