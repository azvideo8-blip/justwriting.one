import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_PASSWORD_LENGTH } from '../../src/shared/constants/passwordPolicy';

// 27.10 (владелец): минимум длины пароля на сервере входа = минимум клиента.
// GoTrue по умолчанию принимает 6, и форма с её 8 обходилась прямым запросом.
// Мутация: убрать строку из override или поменять число с любой стороны → красный.
describe('GoTrue: минимум длины пароля совпадает с клиентом', () => {
  it('GOTRUE_PASSWORD_MIN_LENGTH = MIN_PASSWORD_LENGTH', () => {
    const yml = readFileSync(join(process.cwd(), 'deploy', 'supabase-compose.override.yml'), 'utf8');
    const m = /GOTRUE_PASSWORD_MIN_LENGTH:\s*"(\d+)"/.exec(yml);
    expect(m, 'строки GOTRUE_PASSWORD_MIN_LENGTH в override нет').not.toBeNull();
    expect(Number(m![1])).toBe(MIN_PASSWORD_LENGTH);
  });
});
