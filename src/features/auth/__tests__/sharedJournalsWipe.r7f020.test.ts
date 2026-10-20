// R7F-020 + S0-2: общие журналы ожидающей синхронизации стирались выходом ЛЮБОГО
// аккаунта. Подметание clearAccountScopedStorage() сносит всё, что не объявлено
// настройкой устройства и не помечено чужим uid, — а журналы лежали под ОДНИМ
// ключом и хранили записи всех аккаунтов браузера. Выход A с очисткой уносил у B
// ожидающие облачные удаления (следующее восстановление возвращало в облако
// удалённый разбор B) и долг секунд за уже выгруженные ряды версий.
//
// S0-2 перенёс журналы на ключ учётки (`base:<uid>`): свой ключ сносится целиком,
// чужой защищается по ФОРМЕ (семейства выводятся из объявленного списка). Общие
// ключи прежней формы живут один релиз — для них остаётся вырезание своих строк.
import { describe, it, expect, beforeEach } from 'vitest';
import { accountScopedLocalStorageKeys, clearAccountScopedStorage } from '../services/accountScopedKeys';

// Префикс записан в тесте литералом, а не импортом: тест обязан краснеть на
// посадке по поведению, а не по несуществующему имени.
const THEME_TOUCHES_PREFIX = 'jw_pending_theme_touches_';

const A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const B = 'ffffffff-1111-4222-8333-444444444444';

const JOURNAL_BASES = [
  'sync_pending_duration',
  'ai_sync_pending_deletes',
  'ai_sync_pending_upserts',
  'ai_sync_dead_upserts',
  'ai_sync_pending_analysis_deletes',
] as const;

/** Строки прежнего общего ключа: по две на аккаунт, у B — с разными полями. */
const LEGACY: Record<string, unknown[]> = {
  sync_pending_duration: [
    { uid: A, docId: 'doc-a', seconds: 120 },
    { uid: B, docId: 'doc-b', seconds: 340 },
  ],
  ai_sync_pending_deletes: [
    { uid: A, store: 'aiThemeLedger', key: 'ledger-a' },
    { uid: B, store: 'aiThemeLedger', key: 'ledger-b' },
  ],
  ai_sync_pending_upserts: [
    { uid: A, store: 'aiPortrait', key: 'p-a' },
    { uid: B, store: 'aiPortrait', key: 'p-b' },
  ],
  ai_sync_dead_upserts: [
    { uid: A, store: 'aiThreads', key: 't-a', lastError: 'x', attempts: 3, timestamp: 1 },
    { uid: B, store: 'aiThreads', key: 't-b', lastError: 'y', attempts: 2, timestamp: 2 },
  ],
  ai_sync_pending_analysis_deletes: [
    { uid: A, canonicalId: 'c-a' },
    { uid: B, canonicalId: 'c-b' },
  ],
};

/** Журнал на ключе учётки (S0-2) — те же строки, но по одному аккаунту на ключ. */
function seedPerAccount(): void {
  for (const [base, rows] of Object.entries(LEGACY)) {
    localStorage.setItem(`${base}:${A}`, JSON.stringify(rows.filter(r => (r as { uid: string }).uid === A)));
    localStorage.setItem(`${base}:${B}`, JSON.stringify(rows.filter(r => (r as { uid: string }).uid === B)));
  }
}

function read(key: string): Array<{ uid: string }> {
  const raw = localStorage.getItem(key);
  return raw === null ? [] : JSON.parse(raw) as Array<{ uid: string }>;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('R7F-020 / S0-2: журнал одного аккаунта не трогает выход другого', () => {
  it('общий журнал прежней формы: выход A оставляет записи B во всех пяти журналах', () => {
    for (const [key, list] of Object.entries(LEGACY)) localStorage.setItem(key, JSON.stringify(list));
    clearAccountScopedStorage(A);

    for (const key of Object.keys(LEGACY)) {
      const rest = read(key);
      expect(rest.map(e => e.uid), `${key}: чужие записи стёрты выходом A`).toEqual([B]);
    }
  });

  it('журнал на ключе учётки: сносится свой, чужой остаётся во всех пяти', () => {
    seedPerAccount();
    clearAccountScopedStorage(A);

    for (const base of JOURNAL_BASES) {
      expect(localStorage.getItem(`${base}:${A}`), `${base}: ключ A не удалён`).toBeNull();
      const foreign = read(`${base}:${B}`);
      expect(foreign.map(e => e.uid), `${base}: ключ B задет выходом A`).toEqual([B]);
    }
  });

  it('собственный журнал не оставляется пустым ключом', () => {
    localStorage.setItem(`ai_sync_pending_deletes:${A}`, JSON.stringify([{ uid: A, store: 'aiPortrait', key: 'only-a' }]));
    localStorage.setItem('sync_pending_duration', JSON.stringify([{ uid: A, docId: 'd', seconds: 5 }]));

    clearAccountScopedStorage(A);

    expect(localStorage.getItem('ai_sync_pending_deletes'), 'пустой общий журнал не обязан переживать выход').toBeNull();
    expect(localStorage.getItem(`ai_sync_pending_deletes:${A}`)).toBeNull();
    expect(localStorage.getItem('sync_pending_duration')).toBeNull();
  });

  it('нечитаемый общий журнал — это не чужие данные, он сносится', () => {
    localStorage.setItem('ai_sync_pending_upserts', '{обрывок');
    clearAccountScopedStorage(A);
    expect(localStorage.getItem('ai_sync_pending_upserts')).toBeNull();
  });

  it('журнал theme-касалок лежит по аккаунту и объявлен в списке', () => {
    expect(accountScopedLocalStorageKeys(A)).toContain(`${THEME_TOUCHES_PREFIX}${A}`);

    localStorage.setItem(`${THEME_TOUCHES_PREFIX}${B}`, JSON.stringify(['doc-b']));
    localStorage.setItem(`${THEME_TOUCHES_PREFIX}${A}`, JSON.stringify(['doc-a']));

    clearAccountScopedStorage(A);

    expect(localStorage.getItem(`${THEME_TOUCHES_PREFIX}${A}`), 'ключ A не стёрт').toBeNull();
    expect(localStorage.getItem(`${THEME_TOUCHES_PREFIX}${B}`), 'ключ B задет выходом A').not.toBeNull();
  });

  // Флага переноса (прежний `base.scoped.v1:<uid>`) в списке больше нет: SF-8
  // убрал его из кода — он писался и не читался. Выход аккаунта чистит ключи
  // учётки, а общий ключ остаётся до следующего переноса.
  it('журналы учётки объявлены в списке — иначе их не защитит вывод форм', () => {
    for (const base of JOURNAL_BASES) {
      expect(accountScopedLocalStorageKeys(A), `${base}: ключ не объявлен`).toContain(`${base}:${A}`);
    }
  });

  it('прочие ключи A по-прежнему уходят, а B остаётся', () => {
    localStorage.setItem(`draft-${A}`, 'черновик A');
    localStorage.setItem(`draft-${B}`, 'черновик B');
    localStorage.setItem('activity_log_v1', '[{"message":"…"}]');

    clearAccountScopedStorage(A);

    expect(localStorage.getItem(`draft-${A}`)).toBeNull();
    expect(localStorage.getItem(`draft-${B}`)).toBe('черновик B');
    expect(localStorage.getItem('activity_log_v1')).toBeNull();
  });
});
