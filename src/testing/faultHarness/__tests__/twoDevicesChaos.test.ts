import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { ChaosBrowser, ChaosDevice, ChaosTab } from '../chaosBrowser';
import type { FaultType } from '../faultTypes';
import type { TableName } from '../inMemoryPostgres';

async function loadTab(env: ChaosTab) {
  return env.run(async () => {
  vi.resetModules();
  const [lifecycle, storage, sync, cloud, localDb, auth, supabase, crypto, helpers, cursor, editor, flags] = await Promise.all([
    import('../lifecycleRunner'),
    import('../../../core/services/StorageService'),
    import('../../../core/services/SyncService'),
    import('../../../core/services/CloudSyncService'),
    import('../../../core/storage/localDb'),
    import('../../../core/auth'),
    import('../../../core/supabase/client'),
    import('../../../core/crypto/encrypt'),
    import('../../../core/crypto/cryptoHelpers'),
    import('../../../core/sync/revCursor'),
    import('../../../core/sync/activeEditor'),
    import('../../../core/sync/syncFlags'),
  ]);
  const bind = <T extends object>(object: T): T => new Proxy(object, {
    get: (target, name) => {
      const value: unknown = Reflect.get(target, name);
      return typeof value === 'function' ? (...args: unknown[]) => env.run(() => Reflect.apply(value, target, args)) : value;
    },
  });
  return { env, runner: new lifecycle.LifecycleRunner(), storage: bind(storage.StorageService), sync: bind(sync.SyncService),
    cloud: bind(cloud.CloudSyncService), localDb: bind(localDb), auth, supabase, crypto: bind(crypto), helpers: bind(helpers), cursor: bind(cursor), editor: bind(editor), flags: bind(flags) };
  });
}
type Tab = Awaited<ReturnType<typeof loadTab>>;
type DeviceState = { device: ChaosDevice; tab: Tab; other: Tab | undefined };
const seeds = Number(process.env.TWO_DEVICE_CHAOS_SEEDS ?? 4);
const steps = Number(process.env.TWO_DEVICE_CHAOS_STEPS ?? 24);
const firstSeed = Number(process.env.TWO_DEVICE_CHAOS_START ?? 1);
const faults: FaultType[] = ['network_post', 'network_mid', 'postgres_500', 'postgres_409', 'postgres_429'];

function data(content: string) {
  return { title: 'Synthetic note', content, wordCount: 1, duration: 5, wpm: 10, tags: [], sessionStartedAt: new Date() };
}

async function texts(tab: Tab, uid: string) {
  const db = await tab.localDb.getLocalDb(uid);
  const documents = (await db.getAll('documents')).filter(d => d.guestId === uid);
  const everything = new Set<string>();
  const heads = new Map<string, string>();
  for (const doc of documents) {
    const versions = await db.getAllFromIndex('versions', 'by-document', doc.id);
    versions.forEach(v => everything.add(v.content));
    expect(new Set(versions.map(v => v.version)).size, `I2v: ${doc.id} ${JSON.stringify(versions.map(v => [v.version, v.content]))}`).toBe(versions.length);
    if (!doc.trashedAt && !doc.localOnly && !doc.unlinkedByTombstone) {
      heads.set(doc.uuid ?? doc.linkedCloudId ?? doc.id, versions.sort((a, b) => b.version - a.version)[0]?.content ?? '');
    }
  }
  return { everything, heads, documents };
}

async function pullCover(tab: Tab, uid: string, strict = false) {
  const cursor = await tab.cursor.getSyncRevCursor(uid);
  const deferred = await tab.cursor.getSyncRevDeferred(uid);
  const { documents } = await texts(tab, uid);
  const pg = tab.runner.interceptor.postgres;
  const cloudDocs = pg.getRows('documents').filter(d => d.user_id === uid);
  const versionRows = pg.getRows('versions');
  // Фантомный ряд: потерянный ACK оставил documents без единой версии.
  // Текста в нём нет — покрывать нечего; EMPTY_CLOUD_DOCUMENT в отложенных
  // легитимен, ПОКА ряд пуст. После перезаливки покрытие обязательно.
  const isEmptyPhantom = (uuid: unknown) => {
    const row = cloudDocs.find(d => d.uuid === uuid);
    return Boolean(row && !row.deleted_at && !versionRows.some(v => v.document_uuid === uuid));
  };
  for (const row of deferred) {
    expect(['schema', 'DECRYPTION_ERROR', 'EMPTY_CLOUD_DOCUMENT', 'DECRYPT_FAILED_LATEST'], `PULL-TRANSIENT: ${JSON.stringify(row)}`).toContain(row.reason);
  }
  if (strict) {
    const unresolved = deferred.filter(d => !(d.reason === 'EMPTY_CLOUD_DOCUMENT' && isEmptyPhantom(d.uuid)));
    expect(unresolved, `PULL-COVER: deferred rows survived recovery ${JSON.stringify(deferred)}`).toEqual([]);
  }
  const has = (uuid: unknown, rev: unknown) => documents.some(d => d.uuid === uuid || d.linkedCloudId === uuid)
    || (!strict && deferred.some(d => d.uuid === uuid && Number(rev) <= d.rev));
  for (const d of cloudDocs) {
    if (!d.deleted_at && Number(d.rev) <= cursor.documents && !isEmptyPhantom(d.uuid)) expect(has(d.uuid, d.rev), `PULL-COVER document ${String(d.uuid)} deferred=${JSON.stringify(deferred)}`).toBe(true);
  }
  for (const v of versionRows) {
    if (v.user_id !== uid || Number(v.rev) > cursor.versions || cloudDocs.some(d => d.uuid === v.document_uuid && d.deleted_at)) continue;
    expect(has(v.document_uuid, v.rev), `PULL-COVER version ${String(v.id)}`).toBe(true);
  }
}

async function round(tab: Tab, uid: string) {
  // useBackgroundSync.ts:179-180 recovers a save interrupted before enqueueing when connectivity returns.
  await tab.sync.sweepOrphanedDocuments(uid, 0);
  await tab.sync.syncPending(uid, { force: true });
  await tab.sync.pullNotes(uid);
  await pullCover(tab, uid);
}

function pauseResponse(tab: Tab, after: number, log: string[]) {
  let release!: () => void;
  let reached!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { reached = resolve; });
  let seen = 0;
  tab.runner.interceptor.onRequest = async (table, op) => {
    if (++seen !== after) return;
    log.push(`paused response ${seen} ${table}.${op}`);
    reached();
    await wait;
  };
  return { ready, release, count: () => seen };
}

describe('two devices: request faults, vault and overlapping operations', () => {
  let tabs: Tab[];
  let installedRunner: Tab['runner'];
  const browser = new ChaosBrowser();
  const coverage: Record<string, number> = {};
  const hit = (event: string) => { coverage[event] = (coverage[event] ?? 0) + 1; };
  afterAll(() => {
    console.info('CHAOS_COVERAGE', JSON.stringify({ seeds, steps, firstSeed, coverage }));
  });
  afterEach(() => {
    for (const tab of tabs) {
      tab.runner.interceptor.onRequest = undefined;
      tab.runner.interceptor.onBeforeRequest = undefined;
      tab.crypto.clearSessionKey();
      tab.editor.registerActiveEditorDocIdGetter(null);
      tab.localDb.resetDbInstance();
    }
    installedRunner?.teardown();
    browser.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    it(`chaos seed ${seed}`, async ({ onTestFailed }) => {
      const log: string[] = [];
      onTestFailed(() => { console.error(log.join('\n')); });
      try {
        let x = Math.imul(seed, 2654435761) >>> 0;
        const random = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 2 ** 32; };
        const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)]!;
        const deviceA = new ChaosDevice('A'), deviceB = new ChaosDevice('B');
        const envA = browser.createTab(deviceA), envB = browser.createTab(deviceB);
        browser.fallback = envA;
        browser.elapsed = 0;
        browser.install();
        tabs = [];
        for (const env of [envA, envB, browser.createTab(deviceA)]) tabs.push(await loadTab(env));
        const A: DeviceState = { device: deviceA, tab: tabs[0]!, other: tabs[2]! };
        const B: DeviceState = { device: deviceB, tab: tabs[1]!, other: undefined };
        deviceA.storage.set('auto_sync_enabled', 'true');
        deviceB.storage.set('auto_sync_enabled', 'true');
        const runner = A.tab.runner;
        installedRunner = runner;
        runner.vaultEnabled = true;
        await A.tab.env.run(() => runner.setup());
        Date.now = browser.now;
        const uid = runner.userId;
        const key = A.tab.crypto.getSessionKey()!;
        const pg = runner.interceptor.postgres;
        pg.serverNow = browser.serverNow;
        let id = 0;
        vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${(++id).toString(16).padStart(12, '0')}`);
        const connect = (tab: Tab) => {
          tab.runner.interceptor.postgres = pg;
          tab.runner.interceptor.clearArmedFault();
          tab.flags.resetSyncFlagsForTests();
          tab.helpers.setProfileLoaded(uid, true);
          tab.helpers.setEncryptionEnabled(uid, true);
          tab.crypto.setSessionKey(key);
          vi.spyOn(tab.auth, 'getCurrentUser').mockImplementation(() => ({ uid, email: 'chaos@example.test', displayName: 'Synthetic', photoURL: null, metadata: { creationTime: null, lastSignInTime: null } }));
          vi.spyOn(tab.supabase, 'getSupabase').mockImplementation(() => tab.runner.interceptor.createMockSupabaseClient() as never);
        };
        tabs.forEach(connect);
        const activate = (dev: DeviceState) => {
          browser.fallback = dev.tab.env;
          for (const tab of [dev.tab, dev.other].filter((t): t is Tab => Boolean(t))) {
            tab.runner.interceptor.onBeforeRequest = undefined;
            tab.runner.interceptor.onRequest = undefined;
            tab.runner.interceptor.clearArmedFault();
            tab.runner.interceptor.setStep('sync_cloud');
            if (dev.device.offline) tab.runner.interceptor.armFault('network_pre', 'sync_cloud');
          }
        };
        const saved = new Set<string>();
        const deleted = new Set<string>();
        const deletedUuids = new Set<string>();
        const copiesBeforeDeletion = new Map<string, Set<string>>();
        const accept = async (tab: Tab, text: string, operation: () => Promise<unknown>) => {
          try { await operation(); saved.add(text); }
          catch (error) {
            if ((await texts(tab, uid)).everything.has(text)) saved.add(text);
            log.push(`error ${String(error)}`);
          }
        };
        const newNote = async (tab: Tab, text: string) => {
          // Avoid the legacy firstSessionAt fallback collision (twoDevices.test.ts:86).
          await new Promise(resolve => setTimeout(resolve, 2));
          const { localId } = await tab.storage.saveNew(uid, data(text));
          saved.add(text);
          await tab.sync.addToQueue(localId);
          await tab.sync.syncOne(uid, localId);
        };
        activate(A);
        await newNote(A.tab, `start-${seed}`);
        activate(B);
        await round(B.tab, uid);

        let reloaded = false;
        for (let step = 0; step < steps; step++) {
          const dev = pick([A, B]);
          activate(dev);
          const tab = dev.tab;
          const snapshot = await texts(tab, uid);
          const live = snapshot.documents.filter(d => !d.trashedAt).sort((a, b) => a.id.localeCompare(b.id));
          const trashed = snapshot.documents.filter(d => d.trashedAt).sort((a, b) => a.id.localeCompare(b.id));
          const selected = live.length ? pick(live) : undefined;
          const text = `${dev.device.name}-${seed}-${step}`;
          const event = pick(['new', 'edit', 'edit', 'trash', 'delete', 'sync', 'net', 'fault', 'vault', 'overlap', 'double_pull', 'tab', 'clock', 'reload']);
          log.push(`${step}: ${dev.device.name}${dev.device.offline ? '(off)' : ''} ${event} ${selected?.id.slice(-4) ?? '-'} ${text}`);
          if (event === 'net') { dev.device.offline = !dev.device.offline; continue; }
          if (event === 'clock') {
            // Clock correction during a browser session: withDocumentLock.ts:36; saves use Date.now in LocalStorageService.ts.
            hit('clock_backwards');
            dev.device.skew = dev.device.skew ? 0 : -250;
            activate(dev);
          } else if (event === 'new' || (!selected && event === 'edit')) {
            await accept(tab, text, () => newNote(tab, text));
          } else if (event === 'edit' && selected) {
            await accept(tab, text, () => tab.storage.saveVersion(uid, selected.id, data(text)));
          } else if (event === 'trash' && selected) {
            await tab.storage.trashDocument(uid, selected.id, selected.linkedCloudId);
          } else if (event === 'delete' && trashed.length) {
            const doc = pick(trashed);
            const db = await tab.localDb.getLocalDb(uid);
            const versions = await db.getAllFromIndex('versions', 'by-document', doc.id);
            const removedTexts = new Set(versions.map(v => v.content));
            for (const row of pg.getRows('versions').filter(v => v.document_uuid === doc.uuid)) {
              const plain = await tab.helpers.maybeDecrypt(row, ['content'], []);
              removedTexts.add(String(plain.content));
            }
            const rememberCopy = (uuid: string, content: string) => {
              if (uuid === doc.uuid || !removedTexts.has(content)) return;
              const copies = copiesBeforeDeletion.get(content) ?? new Set<string>();
              copies.add(uuid);
              copiesBeforeDeletion.set(content, copies);
            };
            for (const row of pg.getRows('versions')) {
              if (!pg.getRows('documents').some(d => d.uuid === row.document_uuid && !d.deleted_at)) continue;
              const plain = await tab.helpers.maybeDecrypt(row, ['content'], []);
              rememberCopy(String(row.document_uuid), String(plain.content));
            }
            for (const owner of [A, B]) {
              const otherDb = await owner.tab.localDb.getLocalDb(uid);
              for (const copy of (await otherDb.getAll('documents')).filter(d => d.guestId === uid && d.uuid !== doc.uuid)) {
                for (const version of await otherDb.getAllFromIndex('versions', 'by-document', copy.id)) rememberCopy(copy.uuid ?? copy.id, version.content);
              }
            }
            log.push(`delete ${doc.uuid} texts=${versions.map(v => v.content).join(',')}`);
            const result = await tab.storage.deleteDocument(uid, doc.id, doc.linkedCloudId);
            if (result.applied) {
              for (const text of removedTexts) {
                deleted.add(text);
                // A copy remembered at an earlier deletion may be the note being
                // deleted now, or a note already deleted since — neither keeps the text alive.
                const liveCopies = [...(copiesBeforeDeletion.get(text) ?? [])].filter(u => u !== doc.uuid && !deletedUuids.has(u));
                if (!liveCopies.length) saved.delete(text);
              }
              if (doc.uuid) deletedUuids.add(doc.uuid);
            }
          } else if (event === 'fault' && !dev.device.offline) {
            // Lost ACK/HTTP failure: useWritingActions.ts:216 → StorageService.saveVersion → cloud provider.
            const fault = pick(faults);
            const after = 1 + Math.floor(random() * 4);
            const writeOnly = fault === 'postgres_409' || random() < 0.5;
            let requests = 0;
            let armed = false;
            const beforeFault = tab.runner.interceptor.getFaultFiredCount();
            tab.runner.interceptor.onBeforeRequest = (_table: TableName, operation: string) => {
              tab.runner.interceptor.clearArmedFault();
              if (writeOnly && operation === 'select') return;
              if (++requests !== after) return;
              armed = true;
              tab.runner.interceptor.armFault(fault, 'sync_cloud');
            };
            log.push(`${fault} request=${after} writeOnly=${writeOnly}`);
            if (selected) await accept(tab, text, () => tab.storage.saveVersion(uid, selected.id, data(text)));
            else await accept(tab, text, () => newNote(tab, text));
            tab.runner.interceptor.onBeforeRequest = undefined;
            tab.runner.interceptor.clearArmedFault();
            const fired = tab.runner.interceptor.getFaultFiredCount() > beforeFault;
            if (fired) hit(fault);
            log.push(`fault reached=${armed} fired=${fired}`);
          } else if (event === 'vault' && !dev.device.offline) {
            // useEncryptionStore.ts:111-145 idle timer clears the key during a request; unlock resumes sync (AppProviders.tsx:200-203).
            const after = 1 + Math.floor(random() * 4);
            let requests = 0;
            tab.runner.interceptor.onRequest = () => {
              if (++requests === after) {
                expect(tab.crypto.getSessionKey()).not.toBeNull();
                tab.runner.interceptor.armFault('vault_locked', 'sync_cloud');
                expect(tab.crypto.getSessionKey()).toBeNull();
                hit('vault_locked');
              }
            };
            try {
              if (selected && random() < 0.5) await accept(tab, text, () => tab.storage.saveVersion(uid, selected.id, data(text)));
              else await tab.sync.pullNotes(uid);
            } catch (error) { log.push(`vault ${String(error)}`); }
            finally {
              tab.runner.interceptor.onRequest = undefined;
              tab.runner.interceptor.clearArmedFault();
              tab.crypto.setSessionKey(key);
              await tab.sync.reviveLockedTasks(uid);
            }
          } else if (event === 'reload' && !dev.device.offline && selected && !reloaded) {
            // Page termination during save: useWritingActions.ts:216 → StorageService.ts:130; no catch/finally runs in the destroyed tab.
            const gate = pauseResponse(tab, 1 + Math.floor(random() * 4), log);
            const saving = tab.storage.saveVersion(uid, selected.id, data(text)).then(() => undefined, () => undefined);
            if (await Promise.race([gate.ready.then(() => true), saving.then(() => false)])) {
              if ((await texts(tab, uid)).everything.has(text)) saved.add(text);
              tab.env.close();
              tab.localDb.resetDbInstance();
              const fresh = await loadTab(browser.createTab(dev.device));
              expect(fresh.storage).not.toBe(tab.storage);
              expect(fresh.crypto.getSessionKey()).toBeNull();
              expect(fresh.helpers.getEncryptionEnabled(uid)).toBe(true);
              tabs[tabs.indexOf(tab)] = fresh;
              dev.tab = fresh;
              browser.fallback = fresh.env;
              connect(fresh);
              // Browser-owned locks vanish; persisted document leases expire normally after 30 seconds.
              browser.elapsed += 31_000;
              reloaded = true;
              hit('reload');
              log.push('reloaded with retained stores and fresh module memory');
            } else gate.release();
          } else if (['overlap', 'double_pull', 'tab'].includes(event) && !dev.device.offline) {
            // AppProviders.tsx:247-250 visibility pull overlaps writing save (useWritingActions.ts:216) or polling (useBackgroundSync.ts:240).
            // A second tab has separate module singletons, the same IDBFactory/localStorage and browser Web Locks (revCursor.ts:173-176).
            const peer = event === 'tab' ? dev.other : tab;
            if (peer) {
              if (event !== 'double_pull' && selected) peer.editor.registerActiveEditorDocIdGetter(() => selected.id);
              const gate = pauseResponse(tab, 1 + Math.floor(random() * 3), log);
              const upload = event === 'overlap' && seed % 3 === 0;
              const primary = upload ? tab.sync.syncPending(uid) : tab.sync.pullNotes(uid);
              const pull = primary.then(() => undefined, error => { log.push(`sync ${String(error)}`); });
              const reached = await Promise.race([gate.ready.then(() => true), pull.then(() => false)]);
              if (reached) {
                hit(upload ? 'overlap_upload' : event);
                const background = event === 'double_pull' && seed % 2 === 0;
                const second = event !== 'double_pull' && selected
                  ? accept(peer, text, () => peer.storage.saveVersion(uid, selected.id, data(text)))
                  : (background ? peer.cloud.restoreMissingDocuments(uid) : peer.sync.pullNotes(uid)).then(() => undefined, error => { log.push(`second pull ${String(error)}`); });
                if (event !== 'double_pull' && selected && !upload) await second;
                gate.release();
                await Promise.all([pull, second]);
              } else await pull;
              tab.runner.interceptor.onRequest = undefined;
              peer.editor.registerActiveEditorDocIdGetter(null);
              await round(tab, uid);
            }
          } else if (event === 'sync') {
            try { await round(tab, uid); } catch (error) {
              if (!dev.device.offline) throw error;
              log.push(`offline ${String(error)}`);
            }
          }
          await texts(dev.tab, uid);
        }
        A.device.offline = B.device.offline = false;
        // Let the persisted 30s lease expire after the last clock correction (withDocumentLock.ts:36-37).
        browser.elapsed += 31_000;
        for (const dev of [A, B, A, B, A, B, A]) { activate(dev); await round(dev.tab, uid); }
        activate(A); await pullCover(A.tab, uid, true); const a = await texts(A.tab, uid);
        activate(B); await pullCover(B.tab, uid, true); const b = await texts(B.tab, uid);
        const cloudTexts = new Map<unknown, string>();
        for (const row of pg.getRows('versions')) {
          const decoded = await B.tab.helpers.maybeDecrypt(row, ['content'], []);
          cloudTexts.set(row.id, String(decoded.content));
        }
        log.push(`A=${JSON.stringify(a.documents)} heads=${JSON.stringify([...a.heads])}`);
        log.push(`B=${JSON.stringify(b.documents)} heads=${JSON.stringify([...b.heads])}`);
        log.push(`cloud=${JSON.stringify(pg.getRows('documents'))}`);
        log.push(`queueA=${JSON.stringify(await (await A.tab.localDb.getLocalDb(uid)).getAll('syncQueue'))}`);
        log.push(`queueB=${JSON.stringify(await (await B.tab.localDb.getLocalDb(uid)).getAll('syncQueue'))}`);
        const cloud = new Set(cloudTexts.values());
        expect([...saved].filter(t => !a.everything.has(t) && !b.everything.has(t) && !cloud.has(t)), 'I1: lost saved text').toEqual([]);
        expect([...b.heads.values()].sort(), 'I2: devices diverge').toEqual([...a.heads.values()].sort());
        const cloudDocs = pg.getRows('documents');
        for (const uuid of deletedUuids) {
          const row = cloudDocs.find(d => d.uuid === uuid);
          expect(!row || Boolean(row.deleted_at), `I3: revived ${uuid}`).toBe(true);
        }
        const liveUuids = new Set(cloudDocs.filter(d => !d.deleted_at).map(d => d.uuid));
        const revived = pg.getRows('versions').filter(v => {
          const text = cloudTexts.get(v.id)!;
          return liveUuids.has(v.document_uuid) && deleted.has(text) && !copiesBeforeDeletion.get(text)?.has(String(v.document_uuid));
        });
        expect(revived.map(v => cloudTexts.get(v.id)), 'I3: deleted text reappears in a new copy').toEqual([]);
        expect(pg.getRows('versions').filter(v => deletedUuids.has(String(v.document_uuid))), 'I3: deleted versions survive').toEqual([]);
      } catch (error) {
        throw new Error(`${String(error)}\nseed=${seed}, steps=${steps}\n${log.join('\n')}`, { cause: error });
      }
    }, 60_000);
  }
});
