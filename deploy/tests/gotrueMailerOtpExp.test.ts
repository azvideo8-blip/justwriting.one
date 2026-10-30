import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 30.10 (владелец): ссылки из писем (приглашение, сброс пароля) живут 3 дня.
// Мутация: убрать строку из override или поменять число → красный.
describe('GoTrue: срок ссылок из писем — 3 дня', () => {
  it('GOTRUE_MAILER_OTP_EXP = 259200', () => {
    const yml = readFileSync(join(process.cwd(), 'deploy', 'supabase-compose.override.yml'), 'utf8');
    const m = /GOTRUE_MAILER_OTP_EXP:\s*"(\d+)"/.exec(yml);
    expect(m, 'строки GOTRUE_MAILER_OTP_EXP в override нет').not.toBeNull();
    expect(Number(m![1])).toBe(3 * 24 * 3600);
  });

  // Проверка безопасности 30.10: при сроке 3 дня код из письма — 10 знаков.
  it('GOTRUE_MAILER_OTP_LENGTH = 10', () => {
    const yml = readFileSync(join(process.cwd(), 'deploy', 'supabase-compose.override.yml'), 'utf8');
    expect(/GOTRUE_MAILER_OTP_LENGTH:\s*"(\d+)"/.exec(yml)?.[1]).toBe('10');
  });
});

