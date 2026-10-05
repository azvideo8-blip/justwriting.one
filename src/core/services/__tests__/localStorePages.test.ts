import { describe, it, expect } from 'vitest';
import { parseLocalStoreKey, selectCloudVersion } from '../localStorePages';

// S-49: выбор версии записи из её облачных строк. Манифест указывает версию
// точно — страницы, на которые он не ссылается, не читаются даже если они
// свежее (проигравшая попытка, оборванная выгрузка).

const page = (key: string, updatedAt: number, page: number, totalPages: number) =>
  ({ key, payload: { data: `p${page}`, updatedAt, page, totalPages } });

describe('parseLocalStoreKey', () => {
  it('tells apart a whole record, a legacy page, a versioned page and a page of one attempt', () => {
    expect(parseLocalStoreKey('dlg')).toEqual({ baseKey: 'dlg', pageIndex: null, stamp: null, nonce: null });
    expect(parseLocalStoreKey('dlg#3')).toEqual({ baseKey: 'dlg', pageIndex: 3, stamp: null, nonce: null });
    expect(parseLocalStoreKey('dlg#1700#2')).toEqual({ baseKey: 'dlg', pageIndex: 2, stamp: 1700, nonce: null });
    expect(parseLocalStoreKey('a#b')).toEqual({ baseKey: 'a#b', pageIndex: null, stamp: null, nonce: null });
    // M-2: страница попытки — метка стоит перед номером страницы.
    expect(parseLocalStoreKey('dlg#1700#12ab34cd#p2')).toEqual({ baseKey: 'dlg', pageIndex: 2, stamp: 1700, nonce: '12ab34cd' });
  });
});

describe('selectCloudVersion', () => {
  it('M-2: манифест называет попытку — страницы той же отметки с другой меткой не читаются', () => {
    const attemptPage = (key: string, page: number, totalPages: number, nonce: string, data: string) =>
      ({ key, payload: { data, updatedAt: 100, page, totalPages, nonce } });
    const winner = [
      attemptPage('dlg#100#aabbccdd#p0', 0, 2, 'aabbccdd', 'a0'),
      attemptPage('dlg#100#aabbccdd#p1', 1, 2, 'aabbccdd', 'a1'),
    ];
    // Проигравшая попытка успела записать ровно столько же страниц под ту же отметку:
    // без метки набор читался бы как «pages beyond 2» и запись отвергалась навсегда.
    const loser = [
      attemptPage('dlg#100#aabb1122#p0', 0, 2, 'aabb1122', 'мусор'),
      attemptPage('dlg#100#aabb1122#p1', 1, 2, 'aabb1122', 'мусор'),
    ];
    const v = selectCloudVersion([
      { key: 'dlg', payload: { manifest: true, updatedAt: 100, totalPages: 2, nonce: 'aabbccdd' } },
      ...winner, ...loser,
    ]);
    expect(v).toEqual({ kind: 'pages', updatedAt: 100, pages: winner });
  });

  it('M-2: без манифеста страницы разных попыток одной отметки не склеиваются', () => {
    const v = selectCloudVersion([
      { key: 'dlg#100#aaaa1111#p0', payload: { data: 'a0', updatedAt: 100, page: 0, totalPages: 2, nonce: 'aaaa1111' } },
      { key: 'dlg#100#bbbb2222#p1', payload: { data: 'b1', updatedAt: 100, page: 1, totalPages: 2, nonce: 'bbbb2222' } },
    ]);
    expect(v).toEqual({ kind: 'refused', reason: 'incomplete: page 1 of 2 missing' });
  });

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

  // R-1: провайдер отдаёт строки в порядке (store, key), и `key@seg…` сортируется
  // сразу за `key`. Пока сегмент считался кандидатом на «единственную строку»,
  // последнее окно побеждало, `data` в нём не находилось, и читатель молча
  // пропускал диалог на каждом заборе.
  const seg = (key: string, updatedAt: number) =>
    ({ key, payload: { seg: true, headKey: key.split('@')[0], firstAt: 1, updatedAt, messages: '[]' } });

  it('осиротевшее окно не является версией записи: строка `key` остаётся единственной', () => {
    const row = { key: 'dlg', payload: { data: '{}', updatedAt: 10 } };
    expect(selectCloudVersion([row, seg('dlg@seg1-aaaaaaaa', 5)])).toEqual({ kind: 'single', row });
    expect(selectCloudVersion([seg('dlg@seg1-aaaaaaaa', 99), row])).toEqual({ kind: 'single', row });
  });

  it('группа из одних осиротевших окон — «копии нет», а не отказ и не укороченный диалог', () => {
    expect(selectCloudVersion([seg('dlg@seg1-aaaaaaaa', 5), seg('dlg@seg2-bbbbbbbb', 7)])).toBeNull();
  });

  it('страницы 0.9.29 читаются, даже когда рядом лежат осиротевшие окна', () => {
    const v = selectCloudVersion([
      { key: 'dlg', payload: { data: 'целая строка', updatedAt: 10 } },
      page('dlg#0', 100, 0, 2), page('dlg#1', 100, 1, 2),
      seg('dlg@seg1-aaaaaaaa', 90),
    ]);
    expect(v).toEqual({ kind: 'pages', updatedAt: 100, pages: [page('dlg#0', 100, 0, 2), page('dlg#1', 100, 1, 2)] });
  });

  it('строка другой записи в группе — отказ, а не «эта строка и есть версия»', () => {
    const v = selectCloudVersion([
      { key: 'dlg', payload: { data: '{}', updatedAt: 10 } },
      { key: 'другой-диалог', payload: { data: '{}', updatedAt: 20 } },
    ]);
    expect(v?.kind).toBe('refused');
  });
});
