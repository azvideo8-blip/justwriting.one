// MF-21 (SA-13): строка «Синхронизация» в профиле печатала сырой шаблон
// «{count} заметок ждут…» для любого незнакомого статуса. Таблица по всем
// статусам: шаблонных скобок нет нигде, ожидающие склоняются.
import { describe, it, expect } from 'vitest';
import { syncStatusText } from '../syncStatusText';
import { commonTranslations } from '../../../shared/i18n/translations/common';
import { settingsTranslations } from '../../../shared/i18n/translations/settings';
import type { SyncStatus } from '../../../core/sync/useSyncStatus';

const dict = { ...commonTranslations, ...settingsTranslations } as Record<string, { ru: string }>;
const t = (k: string, p?: Record<string, string>) =>
  Object.entries(p ?? {}).reduce((s, [a, b]) => s.replace(`{${a}}`, b), dict[k]?.ru ?? k);
const tp = (k: string, n: number) => {
  const m10 = n % 10, m100 = n % 100;
  const suf = m100 >= 11 && m100 <= 14 ? '_many' : m10 === 1 ? '_one' : m10 >= 2 && m10 <= 4 ? '_few' : '_many';
  return t(k + suf, { count: String(n) });
};

const ALL: SyncStatus[] = ['synced', 'offline', 'cloud_unavailable', 'pending', 'unsynced', 'sync_off', 'ai_store_unsynced'];
const state = (status: SyncStatus, pendingCount = 2) => ({ status, pendingCount, unsyncedCount: 3, aiStorePendingCount: 1, aiStoreDeadCount: 0 });

describe('MF-21: profile sync line', () => {
  it.each(ALL)('%s → no raw «{…}» placeholder, no missing key', (status) => {
    const out = syncStatusText(state(status), t, tp);
    expect(out).not.toMatch(/[{}]/);
    expect(out).not.toMatch(/^[a-z_]+$/);
  });

  it('pending 1/2/5 → «1 заметка ждёт», «2 заметки ждут», «5 заметок ждут»', () => {
    expect(syncStatusText(state('pending', 1), t, tp)).toBe('1 заметка ждёт отправки');
    expect(syncStatusText(state('pending', 2), t, tp)).toBe('2 заметки ждут отправки');
    expect(syncStatusText(state('pending', 5), t, tp)).toBe('5 заметок ждут отправки');
  });
});
