// DA-10 (владелец 27.11): выгрузка диагностики писала «заметок 0» при живых заметках —
// счётчики считает только вкладка «Статистика». Мутация: класть stats без проверки
// statsLoaded — красный.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

import { buildDiagnosticsReport } from '../DiagnosticsPage';

const stats = { localDocs: 0, cloudDocs: 0, aiProcessed: 0, dialogues: 0, summaries: 0, embeddings: 0, customPersonas: 0, memories: 0 };

describe('DA-10: выгрузка диагностики', () => {
  it('счётчики не посчитаны — null с причиной, а не нули', () => {
    const r = buildDiagnosticsReport({ pendingCount: 0, stats, statsLoaded: false, statsFailed: false });
    expect(r.localStats).toBeNull();
    expect(r.localStatsMissing).toBe('not_loaded_open_stats_tab');
  });

  it('чтение упало — null и «read_failed»', () => {
    const r = buildDiagnosticsReport({ pendingCount: 0, stats, statsLoaded: true, statsFailed: true });
    expect(r.localStats).toBeNull();
    expect(r.localStatsMissing).toBe('read_failed');
  });

  it('посчитаны — как есть', () => {
    const r = buildDiagnosticsReport({ pendingCount: 2, stats: { ...stats, localDocs: 5 }, statsLoaded: true, statsFailed: false });
    expect(r.localStats).toMatchObject({ localDocs: 5 });
    expect(r).not.toHaveProperty('localStatsMissing');
    expect(r).toHaveProperty('browserOnline');
    expect(r).not.toHaveProperty('isCloudConnected');
  });
});
