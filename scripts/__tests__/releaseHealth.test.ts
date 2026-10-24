import { describe, it, expect } from 'vitest';
import { releaseHealth } from '../release-health.mjs';

// Мутации: считать хотфиксом любой коммит (и docs) → (а) красный; не узнавать
// старую форму `chore(release):` → (б) красный.
describe('release-health', () => {
  const H = 3600;
  const log = [
    { sha: 'a', at: 0, subject: 'chore(release): 0.9.34 (тихий)', files: ['src/version.ts'] },
    { sha: 'b', at: 2 * H, subject: 'fix: панель диктовки', files: ['src/x.ts'] },
    { sha: 'c', at: 3 * H, subject: 'docs: справочник', files: ['AGENTS.md'] },
    { sha: 'd', at: 10 * H, subject: 'release: 0.9.35 — правки', files: ['src/version.ts'] },
    { sha: 'e', at: 60 * H, subject: 'Revert "release: 0.9.35"', files: ['src/version.ts'] },
    { sha: 'f', at: 70 * H, subject: 'release: 0.9.36', files: ['src/version.ts'] },
  ];

  it('(а) хотфикс — только правка кода между выпусками', () => {
    const h = releaseHealth(log);
    expect(h.releases.map(r => r.hotfixes)).toEqual([1, 1, 0]);
    expect(h.hotfixed).toBe(2);
  });

  it('(б) обе формы выпускного коммита, часы до следующего, откаты', () => {
    const h = releaseHealth(log);
    expect(h.releases.map(r => r.version)).toEqual(['0.9.34', '0.9.35', '0.9.36']);
    expect(h.releases.map(r => r.hoursToNext)).toEqual([10, 60, null]);
    expect(h.quickFollowUps).toBe(1);
    expect(h.reverts).toBe(1);
  });
});
