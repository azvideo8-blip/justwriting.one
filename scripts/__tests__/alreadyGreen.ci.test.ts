// Решение владельца 2026-10-20: CI на main пропускает тяжёлые джобы, только если
// то же дерево уже прошло полный CI на ветке. Каждый кейс — способ ошибочно
// засчитать двойника; мутация любого условия в findGreenTwin краснит свой кейс.
import { describe, it, expect } from 'vitest';
import { findGreenTwin } from '../ci/already-green.mjs';

const trees: Record<string, string> = { main_sha: 'T1', branch_same: 'T1', branch_other: 'T2' };
const treeOf = async (sha: string) => trees[sha] ?? 'T?';
const E2E_RAN = [{ name: 'Mobile e2e on the stand', conclusion: 'success' }];
const allGreen = async () => [
  { name: 'build', conclusion: 'success' }, { name: 'rls', conclusion: 'success' }, { name: 'mobile-e2e', conclusion: 'success', steps: E2E_RAN },
];
const run = (o: Record<string, unknown>) => ({ id: 1, head_sha: 'branch_same', head_branch: 'release-x', event: 'push', status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml', ...o });

describe('findGreenTwin', () => {
  it('то же дерево, зелёный push-прогон ветки, все тяжёлые джобы success — двойник', async () => {
    expect(await findGreenTwin({ sha: 'main_sha', runs: [run({})], treeOf, jobsOf: allGreen })).toBe(1);
  });

  it('другое дерево — нет', async () => {
    expect(await findGreenTwin({ sha: 'main_sha', runs: [run({ head_sha: 'branch_other' })], treeOf, jobsOf: allGreen })).toBeNull();
  });

  it('прогон на main, pull_request, незавершённый или не success — нет', async () => {
    for (const o of [{ head_branch: 'main' }, { event: 'pull_request' }, { status: 'in_progress' }, { conclusion: 'failure' }, { path: '.github/workflows/gates.yml' }]) {
      expect(await findGreenTwin({ sha: 'main_sha', runs: [run(o)], treeOf, jobsOf: allGreen }), JSON.stringify(o)).toBeNull();
    }
  });

  it('у двойника тяжёлый джоб пропущен (двойник двойника) или упал — нет', async () => {
    const skipped = async () => [{ name: 'build', conclusion: 'skipped' }, { name: 'rls', conclusion: 'success' }, { name: 'mobile-e2e', conclusion: 'success', steps: E2E_RAN }];
    const missing = async () => [{ name: 'build', conclusion: 'success' }, { name: 'rls', conclusion: 'success' }];
    expect(await findGreenTwin({ sha: 'main_sha', runs: [run({})], treeOf, jobsOf: skipped })).toBeNull();
    expect(await findGreenTwin({ sha: 'main_sha', runs: [run({})], treeOf, jobsOf: missing })).toBeNull();
  });

  // Проверка коммита 5fbab718: джоб mobile-e2e «success», а сам e2e пропущен
  // внутренним гейтом (push не трогал приложение) — такой двойник не годится.
  // Мутация: не требовать шаг — красный.
  it('мобильный e2e внутри двойника не выполнялся — нет', async () => {
    const e2eSkipped = async () => [
      { name: 'build', conclusion: 'success' }, { name: 'rls', conclusion: 'success' },
      { name: 'mobile-e2e', conclusion: 'success', steps: [{ name: 'Mobile e2e on the stand', conclusion: 'skipped' }] },
    ];
    expect(await findGreenTwin({ sha: 'main_sha', runs: [run({})], treeOf, jobsOf: e2eSkipped })).toBeNull();
  });
});
