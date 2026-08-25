// Баг с экрана: в заголовке группы по дате стояло «archive_note_count» вместо
// числа. tp(), не найдя ключа, возвращает сам ключ — промах перевода выглядит
// как строка интерфейса и живёт, пока кто-нибудь не заметит глазами.
// Тест проверяет две вещи: что ключи на месте и что ни один вызов tp() в коде
// не остался без перевода.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { translations } from '../index';

const RU_SUFFIXES = ['_one', '_few', '_many'];

function collectTpKeys(dir: string, acc: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { collectTpKeys(p, acc); continue; }
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) continue;
    const src = readFileSync(p, 'utf-8');
    for (const m of src.matchAll(/\btp\(\s*['"]([a-z0-9_]+)['"]/gi)) {
      if (m[1]) acc.add(m[1]);
    }
  }
}

describe('плюральные ключи tp() существуют', () => {
  it('archive_note_count переведён во всех трёх формах', () => {
    for (const suffix of RU_SUFFIXES) {
      const entry = translations[`archive_note_count${suffix}`];
      expect(entry, `нет ключа archive_note_count${suffix}`).toBeDefined();
      expect(entry?.ru).toContain('{count}');
      expect(entry?.en).toContain('{count}');
    }
  });

  it('ни один вызов tp() в коде не остался без перевода', () => {
    const keys = new Set<string>();
    collectTpKeys(join(process.cwd(), 'src'), keys);
    expect(keys.size).toBeGreaterThan(0);

    const missing = [...keys].filter(
      k => !RU_SUFFIXES.some(sfx => translations[`${k}${sfx}`] !== undefined),
    );
    expect(missing, `tp() зовут с ключами, которых нет: ${missing.join(', ')}`).toEqual([]);
  });
});
