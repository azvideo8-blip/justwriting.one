import { describe, it, expect } from 'vitest';
import { parseLocalStoreKey, selectCloudVersion } from '../localStorePages';

// S-49: выбор версии записи из её облачных строк. Манифест указывает версию
// точно — страницы, на которые он не ссылается, не читаются даже если они
// свежее (проигравшая попытка, оборванная выгрузка).

const page = (key: string, updatedAt: number, page: number, totalPages: number) =>
  ({ key, payload: { data: `p${page}`, updatedAt, page, totalPages } });

describe('parseLocalStoreKey', () => {
  it('tells apart a whole record, a legacy page and a versioned page', () => {
    expect(parseLocalStoreKey('dlg')).toEqual({ baseKey: 'dlg', pageIndex: null, stamp: null });
    expect(parseLocalStoreKey('dlg#3')).toEqual({ baseKey: 'dlg', pageIndex: 3, stamp: null });
    expect(parseLocalStoreKey('dlg#1700#2')).toEqual({ baseKey: 'dlg', pageIndex: 2, stamp: 1700 });
    expect(parseLocalStoreKey('a#b')).toEqual({ baseKey: 'a#b', pageIndex: null, stamp: null });
  });
});

describe('selectCloudVersion', () => {
  it('with a manifest only its pages are read; a newer unreferenced version is ignored', () => {
    const v = selectCloudVersion([
      { key: 'dlg', payload: { manifest: true, updatedAt: 100, totalPages: 2 } },
      page('dlg#100#0', 100, 0, 2), page('dlg#100#1', 100, 1, 2),
      page('dlg#200#0', 200, 0, 2), page('dlg#200#1', 200, 1, 2),
      page('dlg#0', 300, 0, 1),
    ]);
    expect(v).toEqual({ kind: 'pages', updatedAt: 100, pages: [page('dlg#100#0', 100, 0, 2), page('dlg#100#1', 100, 1, 2)] });
  });

  it('a manifest whose pages are incomplete is refused, not read from another version', () => {
    const v = selectCloudVersion([
      { key: 'dlg', payload: { manifest: true, updatedAt: 100, totalPages: 2 } },
      page('dlg#100#0', 100, 0, 2),
      page('dlg#200#0', 200, 0, 1),
    ]);
    expect(v?.kind).toBe('refused');
  });

  it('without a manifest: the newest complete legacy version wins; a whole row wins when it is newer', () => {
    const legacy = selectCloudVersion([page('dlg#0', 100, 0, 2), page('dlg#1', 100, 1, 2), page('dlg#2', 50, 2, 3)]);
    expect(legacy).toEqual({ kind: 'pages', updatedAt: 100, pages: [page('dlg#0', 100, 0, 2), page('dlg#1', 100, 1, 2)] });

    const row = { key: 'dlg', payload: { data: 'x', updatedAt: 150 } };
    expect(selectCloudVersion([row, page('dlg#0', 100, 0, 1)])).toEqual({ kind: 'single', row });
    expect(selectCloudVersion([{ key: 'dlg', payload: { data: 'x', updatedAt: 50 } }, page('dlg#0', 100, 0, 1)])?.kind).toBe('pages');
  });

  it('nothing → null; a lone whole row → single', () => {
    expect(selectCloudVersion([])).toBeNull();
    const row = { key: 'dlg', payload: { data: 'x' } };
    expect(selectCloudVersion([row])).toEqual({ kind: 'single', row });
  });
});
