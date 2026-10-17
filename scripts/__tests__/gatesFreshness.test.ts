import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { staleGateWarnings } from '../ci/gates-freshness.mjs';

// R5-013/R5-021/R5-053: пропущенный или красный плановый прогон gates.yml
// обязан быть виден. Фальсификация: считать и failure успехом, убрать ветку
// «не найдено» или сравнить возраст не с тем порогом — краснеет.
const NOW = Date.parse('2026-10-01T00:00:00Z');
const SECRETS = 'Full-history secret scan (B-4 / R2-017)';
const HEAVY = 'Testability & Mutations Gates';
const job = (name: string, conclusion: string, completed_at: string) => ({ name, conclusion, completed_at });

describe('gates-freshness', () => {
  it('оба в срок — тишина', () => {
    expect(staleGateWarnings([
      job(SECRETS, 'success', '2026-09-30T09:44:06Z'),
      job(HEAVY, 'success', '2026-09-29T02:39:18Z'),
    ], NOW)).toEqual([]);
  });

  it('красный или пропущенный прогон не считается', () => {
    const w = staleGateWarnings([
      job(SECRETS, 'success', '2026-09-27T09:44:06Z'),
      job(SECRETS, 'failure', '2026-09-30T09:44:06Z'),
      job(HEAVY, 'skipped', '2026-09-30T09:44:06Z'),
    ], NOW);
    expect(w).toHaveLength(2);
    expect(w[0]).toContain('3.6 сут');
    expect(w[1]).toContain('не найдено');
  });

  it('недельный порог — 8 суток', () => {
    expect(staleGateWarnings([
      job(SECRETS, 'success', '2026-09-30T20:00:00Z'),
      job(HEAVY, 'success', '2026-09-23T01:00:00Z'),
    ], NOW)).toEqual([]);
    expect(staleGateWarnings([
      job(SECRETS, 'success', '2026-09-30T20:00:00Z'),
      job(HEAVY, 'success', '2026-09-22T23:00:00Z'),
    ], NOW)).toHaveLength(1);
  });
});

// S-16 (R7Q-036): у этого файла тестировалась только чистая функция, а врата
// входа (`if (argv[1] === …) main()`) — нет: удали их, и гейт превращается в
// тихий no-op с зелёным прогоном. На Windows это уже случилось: локальное
// сравнение путей не сходится, и скрипт молча ничего не делает (R7 T-0).
describe('S-16: врата входа gates-freshness', () => {
  const script = join(process.cwd(), 'scripts', 'ci', 'gates-freshness.mjs');

  it('запуск скриптом исполняет main(): есть вывод, а не тишина', () => {
    const r = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_REPOSITORY: 'azvideo8-blip/justwriting.one', GH_TOKEN: '' },
      timeout: 60_000,
    });
    const out = `${r.stdout}${r.stderr}`;
    // С пустым токеном запрос не проходит — и это обязано быть сказано.
    expect(out, 'скрипт промолчал: main() не исполнился').toContain('свежесть gates.yml не измерена');
    // «не измерено» — не падение выкатки.
    expect(r.status).toBe(0);
  });

  it('импорт модуля не запускает сеть и не печатает', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../ci/gates-freshness.mjs');
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
