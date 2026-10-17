// R7F-020: общие журналы ожидающей синхронизации стирались выходом ЛЮБОГО
// аккаунта. Подметание clearAccountScopedStorage() сносит всё, что не объявлено
// настройкой устройства и не помечено чужим uid — а журналы лежат под ОДНИМ
// ключом и хранят записи всех аккаунтов этого браузера. Выход A с очисткой
// уносил у B ожидающие облачные удаления (следующее восстановление возвращало в
// облако удалённый разбор B) и долг секунд за уже выгруженные ряды версий.
//
// Правка: у журнала запись подписана uid — стирать СВОИ записи, а не ключ.
// Журнал тем-касалок uid в записи не держит (только id документов), поэтому он
// переезжает на ключ по аккаунту.
import { describe, it, expect, beforeEach } from 'vitest';
import { accountScopedLocalStorageKeys, clearAccountScopedStorage } from '../services/accountScopedKeys';

// Префикс写在 тесте литералом, а не импортом: тест обязан краснеть на посадке
// по поведению, а не по несуществующему имени.
const THEME_TOUCHES_PREFIX = 'jw_pending_theme_touches_';

const A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const B = 'ffffffff-1111-4222-8333-444444444444';

const JOURNALS: Record<string, unknown[]> = {
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
};

function seed(): void {
  for (const [key, list] of Object.entries(JOURNALS)) {
    localStorage.setItem(key, JSON.stringify(list));
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

describe('R7F-020: общий журнал переживает выход другого аккаунта', () => {
  it('выход A оставляет записи B во всех четырёх журналах', () => {
    seed();
    clearAccountScopedStorage(A);

    for (const key of Object.keys(JOURNALS)) {
      const rest = read(key);
      expect(rest.map(e => e.uid), `${key}: чужие записи стёрты выходом A`).toEqual([B]);
    }
  });

  it('собственные записи A уходят целиком, и пустой ключ не остаётся', () => {
    localStorage.setItem('ai_sync_pending_deletes', JSON.stringify([{ uid: A, store: 'aiPortrait', key: 'only-a' }]));
    localStorage.setItem('sync_pending_duration', JSON.stringify([{ uid: A, docId: 'd', seconds: 5 }]));

    clearAccountScopedStorage(A);

    expect(localStorage.getItem('ai_sync_pending_deletes'), 'пустой журнал не обязан переживать выход').toBeNull();
    expect(localStorage.getItem('sync_pending_duration')).toBeNull();
  });

  it('нечитаемый журнал — это не чужие данные, он сносится', () => {
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
