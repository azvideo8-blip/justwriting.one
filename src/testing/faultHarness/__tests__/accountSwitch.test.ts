import { describe, it, expect, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { LifecycleRunner } from '../lifecycleRunner';
import { getLocalDb, resetDbInstance } from '../../../core/storage/localDb';
import { StorageService } from '../../../core/services/StorageService';
import { SyncService } from '../../../core/services/SyncService';
import { WritingDraftService } from '../../../features/writing/services/WritingDraftService';
import { setEncryptionEnabled, setProfileLoaded } from '../../../core/crypto/cryptoHelpers';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import type { LocalDraft } from '../../../core/storage/localDb';

/**
 * Два аккаунта в одном браузере, смена без перезагрузки страницы.
 *
 * Класс, а не случай: за четыре раунда аудита текст одного человека попадал
 * к другому разными путями (черновик, фоновая вкладка, чтение без проверки
 * владельца). Здесь всё, что фоновая работа прежнего человека может делать в
 * момент смены, прогоняется со сменой в КАЖДОЙ точке — после каждого запроса
 * к серверу и перед каждым открытием локальной базы, — а после смены
 * новый человек проходит свой обычный старт. Проверка одна на все пути:
 * текст A не появляется ни в базе устройства B, ни в облачных строках B, и
 * у A ничего не пропадает.
 *
 * Сервер — как на проде, с RLS: запрос видит и пишет только строки того, чья
 * сейчас сессия.
 */

const A = 'user_acc_A';
const B = 'user_acc_B';
const MARK = {
  synced: 'ZZA_SYNCED_7f3',
  queued: 'ZZA_QUEUED_7f3',
  cloudOnly: 'ZZA_CLOUDONLY_7f3',
  edit: 'ZZA_EDIT_7f3',
  draft: 'ZZA_DRAFT_7f3',
};
const A_MARKERS = Object.values(MARK);
const B_TEXT = 'ZZB_OWN_2c9';

const runner = new LifecycleRunner();

function signInAs(uid: string): void {
  runner.userId = uid;
  runner.setCurrentUser({
    uid, email: `${uid}@example.test`, displayName: null, photoURL: null,
    metadata: { creationTime: null, lastSignInTime: null },
  });
  setProfileLoaded(uid, true);
  setEncryptionEnabled(uid, false);
  localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(uid), 'true');
}

async function dump(dbKey: string): Promise<string> {
  const db = await getLocalDb(dbKey);
  const parts: string[] = [];
  for (const name of Array.from(db.objectStoreNames)) {
    parts.push(`${name}:${JSON.stringify(await db.getAll(name as never))}`);
  }
  return parts.join('\n');
}

// Смена посреди работы не должна ни терять, ни плодить: одна версия заметки —
// одна строка, одна облачная заметка — одна локальная.
async function duplicates(uid: string): Promise<string[]> {
  const db = await getLocalDb(uid);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of await db.getAll('versions')) {
    const key = `${v.documentId}#${v.version}`;
    if (seen.has(key)) out.push(`версия ${key}`);
    seen.add(key);
  }
  const linked = new Set<string>();
  for (const d of await db.getAll('documents')) {
    const key = d.uuid ?? d.linkedCloudId;
    if (!key) continue;
    if (linked.has(key)) out.push(`заметка ${key}`);
    linked.add(key);
  }
  return out;
}

function cloudRowsOf(uid: string): string {
  const pg = runner.interceptor.postgres;
  const out: string[] = [];
  for (const t of pg.getTableNamesWithColumn('user_id')) {
    out.push(...pg.getRows(t).filter(r => r['user_id'] === uid).map(r => `${t}:${JSON.stringify(r)}`));
  }
  out.push(...pg.getRows('users').filter(r => r['uid'] === uid).map(r => `users:${JSON.stringify(r)}`));
  return out.join('\n');
}

function note(content: string, at = Date.now()) {
  return { title: 'Note', content, wordCount: 1, duration: 5, wpm: 10, tags: [], sessionStartedAt: new Date(at) };
}

function draft(uid: string, content: string): LocalDraft {
  return { userId: uid, content, title: '', wordCount: 1, updatedAt: Date.now() } as unknown as LocalDraft;
}

interface Seed { syncedId: string; queuedId: string }

// A: одна заметка в облаке, одна ждёт в очереди, одна есть только в облаке
// (написана на другом устройстве), черновик локально и в облаке.
async function seedA(): Promise<Seed> {
  signInAs(A);
  const { localId: syncedId } = await StorageService.saveNew(A, note(MARK.synced, 1000));
  await StorageService.addCloudCopy(A, syncedId);

  localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(A), 'false');
  const { localId: queuedId } = await StorageService.saveNew(A, note(MARK.queued, 2000));
  await SyncService.addToQueue(queuedId);
  localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(A), 'true');

  const pg = runner.interceptor.postgres;
  pg.executeInsert('documents', {
    uuid: 'cloud_only_A', user_id: A, title: 'Other device', total_words: 1, total_duration: 5,
    current_version: 1, first_session_at: new Date(3000).toISOString(), last_session_at: new Date(3000).toISOString(),
  });
  pg.executeInsert('versions', {
    document_uuid: 'cloud_only_A', user_id: A, version: 1, content: MARK.cloudOnly, word_count: 1,
    duration: 5, saved_at: new Date(3000).toISOString(), session_started_at: new Date(3000).toISOString(),
  });

  const d = draft(A, MARK.draft);
  await WritingDraftService.saveToLocal(d);
  await WritingDraftService.saveDraftToCloud(d);
  return { syncedId, queuedId };
}

// Фоновая работа A, которая может идти в момент смены аккаунта.
const IN_FLIGHT: Record<string, (s: Seed) => Promise<unknown>> = {
  syncPending: () => SyncService.syncPending(A, { force: true }),
  downloadAll: () => SyncService.downloadAllFromCloud(A),
  reconcile: () => SyncService.reconcileLinkedDocuments(A),
  sweepOrphans: () => SyncService.sweepOrphanedDocuments(A, 0),
  saveVersion: s => StorageService.saveVersion(A, s.syncedId, note(MARK.edit, 5000)),
  draftToCloud: () => WritingDraftService.saveDraftToCloud(draft(A, MARK.edit)),
  loadDraft: () => WritingDraftService.loadDraft(A),
};

// Обычный старт B после входа (AppProviders, useBackgroundSync, экран письма).
async function startAsB(): Promise<void> {
  await SyncService.syncPending(B, { force: true });
  await SyncService.downloadAllFromCloud(B);
  await SyncService.reconcileLinkedDocuments(B);
  await SyncService.sweepOrphanedDocuments(B, 0);
  await SyncService.syncPending(B, { force: true });
  await WritingDraftService.loadDraft(B);
  const { localId } = await StorageService.saveNew(B, note(B_TEXT, 9000));
  await StorageService.addCloudCopy(B, localId);
}

// Точка смены: после каждого ответа сервера и перед каждым открытием локальной
// базы. getLocalDb() без uid берёт текущего человека в момент вызова — ровно
// там фоновая работа A и может открыть базу B.
const hook = vi.hoisted(() => ({ onSwitchPoint: null as (() => void) | null }));
vi.mock('../../../core/storage/localDb', async orig => {
  const real = await orig<typeof import('../../../core/storage/localDb')>();
  return {
    ...real,
    getLocalDb: (uid?: string) => { hook.onSwitchPoint?.(); return real.getLocalDb(uid); },
  };
});

async function freshBrowser(): Promise<void> {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetDbInstance();
  runner.userId = A;
  await runner.setup();
  runner.interceptor.rls = true;
  runner.interceptor.onRequest = () => { hook.onSwitchPoint?.(); };
  // Кэш «в облаке уже эта версия черновика» живёт в памяти модуля и пережил бы
  // «новый браузер» — облачная запись черновика молча не случалась бы.
  await WritingDraftService.deleteDraft(A);
  await WritingDraftService.deleteDraft(B);
  sessionStorage.clear();
}

async function runOp(op: string, onPoint: (n: number) => void): Promise<number> {
  await freshBrowser();
  const seed = await seedA();
  let n = 0;
  hook.onSwitchPoint = () => onPoint(++n);
  await IN_FLIGHT[op]!(seed).catch(() => {});
  hook.onSwitchPoint = null;
  return n;
}

function signOutToGuest(): void {
  runner.userId = 'guest';
  runner.setCurrentUser(null);
}

// to: 'B' — сразу вход другим (ссылка-приглашение в этой вкладке);
// 'guest' — выход, а потом вход другим. Гостевая база не безобидна: при
// регистрации её заметки переезжают в новый аккаунт (migrateDocuments).
async function runSwitchAt(op: string, k: number, to: 'B' | 'guest' = 'B'): Promise<string[]> {
  const leave = to === 'B' ? () => signInAs(B) : signOutToGuest;
  let switched = false;
  await runOp(op, n => { if (n === k) { leave(); switched = true; } });
  if (!switched) leave();
  const guestDevice = await dump('justwriting-local');
  signInAs(B);
  await startAsB();

  const problems: string[] = [];
  for (const m of A_MARKERS) if (guestDevice.includes(m)) problems.push(`${m} в гостевой базе`);
  const bDevice = await dump(B);
  const bCloud = cloudRowsOf(B);
  for (const m of A_MARKERS) {
    if (bDevice.includes(m)) problems.push(`${m} в базе устройства B`);
    if (bCloud.includes(m)) problems.push(`${m} в облачных строках B`);
  }
  if (!bDevice.includes(B_TEXT) || !bCloud.includes(B_TEXT)) problems.push('собственная заметка B не сохранилась');

  // У A ничего не пропало: всё его — на его устройстве или в его облаке.
  const aAll = (await dump(A)) + cloudRowsOf(A);
  for (const m of [MARK.synced, MARK.queued, MARK.cloudOnly, MARK.draft]) {
    if (!aAll.includes(m)) problems.push(`${m} пропал у A`);
  }
  for (const uid of [A, B]) {
    for (const d of await duplicates(uid)) problems.push(`у ${uid === A ? 'A' : 'B'} задвоилось: ${d}`);
  }
  return problems.map(p => `${op}@${k}→${to}: ${p}`);
}

describe('два аккаунта в одном браузере: смена без перезагрузки', () => {
  afterEach(() => {
    hook.onSwitchPoint = null;
    runner.interceptor.onRequest = undefined;
    runner.interceptor.rls = false;
    runner.teardown();
  });

  it('исходные данные A действительно лежат где задумано', async () => {
    await freshBrowser();
    await seedA();
    const cloud = cloudRowsOf(A);
    const device = await dump(A);
    expect(cloud).toContain(MARK.synced);
    expect(cloud).toContain(MARK.cloudOnly);
    expect(cloud).toContain(MARK.draft);
    expect(cloud).not.toContain(MARK.queued);
    expect(device).toContain(MARK.queued);
    expect(device).toContain(MARK.draft);
  });

  it('без фоновой работы: B не видит ничего от A', async () => {
    expect(await runSwitchAt('loadDraft', Infinity, 'B')).toEqual([]);
    expect(await runSwitchAt('loadDraft', Infinity, 'guest')).toEqual([]);
  });

  for (const op of Object.keys(IN_FLIGHT)) {
    it(`смена посреди «${op}» A — в каждом запросе к базе`, async () => {
      const total = await runOp(op, () => {});
      expect(total, 'у операции нет точек смены — проверять нечего').toBeGreaterThan(0);
      const problems: string[] = [];
      for (let k = 1; k <= total; k++) {
        problems.push(...await runSwitchAt(op, k, 'B'), ...await runSwitchAt(op, k, 'guest'));
      }
      expect(problems).toEqual([]);
    }, 60_000);
  }
});

