import { describe, it, expect, afterEach, vi } from 'vitest';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import { getLocalDb } from '../../../core/storage/localDb';
import { Device, activeDevice, forgetDevice, activateDevice } from '../harnessDevice';
import { StorageService } from '../../../core/services/StorageService';
import { LocalStorageService } from '../../../core/services/LocalStorageService';
import { SyncService } from '../../../core/services/SyncService';

/**
 * Next-steps №2: two real clients against one cloud.
 *
 * Each «device» has its own IndexedDB (a separate fake IDBFactory) and its own
 * localStorage; the cloud is the harness's in-memory Postgres. Both run the
 * production save and sync code — no hand-written cloud rows for «device B».
 * Устройство и переключение — в ../harnessDevice (SF2-4: тот же цикл нужен
 * записям `local_store_records`, второму спеку про ИИ-данные).
 */

async function allTexts(uid: string): Promise<{ byUuid: Map<string, string>; everything: Set<string> }> {
  const db = await getLocalDb();
  const docs = (await db.getAll('documents')).filter(d => d.guestId === uid);
  const byUuid = new Map<string, string>();
  const everything = new Set<string>();
  for (const d of docs) {
    const vs = await db.getAllFromIndex('versions', 'by-document', d.id);
    vs.forEach(v => everything.add(v.content));
    if (d.trashedAt) continue; // в корзине — не «живая», но текст не потерян
    const latest = vs.sort((a, b) => b.version - a.version)[0];
    byUuid.set(d.uuid ?? d.linkedCloudId ?? d.id, latest?.content ?? '');
  }
  return { byUuid, everything };
}

async function syncRound(uid: string): Promise<void> {
  await SyncService.syncPending(uid, { force: true });
  await SyncService.downloadAllFromCloud(uid);
  await SyncService.reconcileLinkedDocuments(uid);
}

// Как экран письма сохраняет новую заметку (useWritingActions →
// cleanupDraftsAfterSave): локально, в очередь, попытка выгрузки.
async function saveNewNote(uid: string, content: string): Promise<string> {
  // Две заметки с разных устройств в одну миллисекунду сверка связей примет
  // за одну (firstSessionAt — запасной признак для заметок до uuid). В жизни
  // так не бывает; в быстром тесте — бывает, поэтому разводим время.
  await new Promise(r => setTimeout(r, 2));
  const { localId } = await StorageService.saveNew(uid, { title: 'Note', content, wordCount: 1, duration: 5, wpm: 10, tags: [], sessionStartedAt: new Date() });
  await SyncService.addToQueue(localId);
  try { await SyncService.syncOne(uid, localId); } catch { /* остаётся в очереди */ }
  return localId;
}

function save(uid: string, localId: string, content: string, at: number) {
  return StorageService.saveVersion(uid, localId, {
    title: 'Note', content, wordCount: content.split(' ').length, duration: 10, wpm: 10, tags: [],
    sessionStartedAt: new Date(at),
  });
}

describe('№2: two devices, one cloud', () => {
  const runner = new LifecycleRunner();
  afterEach(() => { runner.teardown(); forgetDevice(); });

  it('a note made on A appears on B, and B\'s edit reaches A', async () => {
    const A = new Device('A'), B = new Device('B');
    activateDevice(A);
    await runner.setup();
    const uid = runner.userId;
    A.storage.set('auto_sync_enabled', 'true');

    const aId = await LocalStorageService.createDocument(uid, { title: 'Note', tags: [], firstSessionAt: 1000, lastSessionAt: 1000 });
    await save(uid, aId, 'first from A', 1000);
    await StorageService.addCloudCopy(uid, aId);

    activateDevice(B);
    localStorage.setItem('auto_sync_enabled', 'true');
    await syncRound(uid);
    const onB = await allTexts(uid);
    expect([...onB.byUuid.values()]).toEqual(['first from A']);

    const bDoc = (await (await getLocalDb()).getAll('documents'))[0]!;
    await save(uid, bDoc.id, 'edit from B', 2000);

    activateDevice(A);
    await syncRound(uid);
    const onA = await allTexts(uid);
    expect([...onA.byUuid.values()]).toEqual(['edit from B']);
  });

  it('a note created and edited offline reaches the other device with its latest text', async () => {
    const A = new Device('A'), B = new Device('B');
    activateDevice(B);
    await runner.setup();
    const uid = runner.userId;
    B.storage.set('auto_sync_enabled', 'true'); A.storage.set('auto_sync_enabled', 'true');
    localStorage.setItem('auto_sync_enabled', 'true');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    runner.interceptor.setStep('device_b_edit'); runner.interceptor.armFault('network_pre', 'device_b_edit');
    const id = await saveNewNote(uid, 'offline one');
    let threw = '';
    try { await save(uid, id, 'offline two', Date.now()); } catch (e) { threw = (e as Error).message; }
    const vsLocal = (await (await getLocalDb()).getAllFromIndex('versions', 'by-document', id)).map(v => `${v.version}:${v.content}`).sort();
    const docLocal = await (await getLocalDb()).get('documents', id);
    expect({ threw, vsLocal, cv: docLocal?.currentVersion }).toEqual({ threw: '', vsLocal: ['1:offline one', '2:offline two'], cv: 2 });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    runner.interceptor.clearArmedFault(); runner.interceptor.setStep('initial_write');
    await syncRound(uid);
    const cloud = runner.interceptor.postgres.getRows('versions').map(v => `${v.version}:${v.content}`);
    const docs = runner.interceptor.postgres.getRows('documents').map(d => `cv${d.current_version}`);
    activateDevice(A);
    await syncRound(uid);
    const onA = await allTexts(uid);
    expect({ cloud, docs, a: [...onA.byUuid.values()] }).toEqual({ cloud: expect.anything(), docs: expect.anything(), a: ['offline two'] });
  });

  it('after a fork on B, A\'s next edit of the original still reaches B', async () => {
    const A = new Device('A'), B = new Device('B');
    activateDevice(A);
    await runner.setup();
    const uid = runner.userId;
    A.storage.set('auto_sync_enabled', 'true'); B.storage.set('auto_sync_enabled', 'true');
    const net = (on: boolean) => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
      if (on) { runner.interceptor.clearArmedFault(); runner.interceptor.setStep('initial_write'); }
      else { runner.interceptor.setStep('device_b_edit'); runner.interceptor.armFault('network_pre', 'device_b_edit'); }
    };
    net(true);
    const mA = await saveNewNote(uid, 'a1');
    await save(uid, mA, 'a2', Date.now());
    activateDevice(B); net(true); await syncRound(uid);
    const mB = (await (await getLocalDb()).getAll('documents'))[0]!.id;
    net(false);
    await save(uid, mB, 'b3', Date.now()).catch(() => {});
    await save(uid, mB, 'b4', Date.now()).catch(() => {});
    activateDevice(A); net(true); await save(uid, mA, 'a3', Date.now());
    activateDevice(B); net(true); await syncRound(uid);
    activateDevice(A); net(false); await save(uid, mA, 'a4', Date.now()).catch(() => {});
    net(true); await syncRound(uid);
    activateDevice(B); net(true); await syncRound(uid);
    const vs = (await (await getLocalDb()).getAllFromIndex('versions', 'by-document', mB)).map(v => `${v.version}:${v.content}`).sort();
    const cloud = runner.interceptor.postgres.getRows('documents').map(d => `cv${d.current_version}`);
    expect({ vs, cloud }).toEqual({ vs: ['1:a1', '2:a2', '3:a3', '4:a4'], cloud: expect.anything() });
  });

  // Seeded interleavings of real operations on two devices, with each device
  // going offline at random. Checked at the end, after both come back online
  // and sync a few rounds:
  //  I1 — no saved text is lost: every text a save accepted exists on some
  //       device or in the cloud;
  //  I2 — the devices converge: the same live notes with the same latest text.
  // Глубокий прогон: TWO_DEVICE_SEEDS=500 TWO_DEVICE_STEPS=60 (≈1 мин); отладка —
  // TRACE_DOC=<хвост id> / TRACE_CLOUD=<хвост uuid>.
  const SEEDS = Number(process.env.TWO_DEVICE_SEEDS ?? 60);
  const STEPS = Number(process.env.TWO_DEVICE_STEPS ?? 40);
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`random interleaving, seed ${seed}`, async () => {
      let x = seed * 2654435761 % 2 ** 32;
      const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 2 ** 32; };
      const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;

      const A = new Device('A'), B = new Device('B');
      activateDevice(A);
      await runner.setup();
      const uid = runner.userId;
      A.storage.set('auto_sync_enabled', 'true');
      B.storage.set('auto_sync_enabled', 'true');
      // Детерминированные id: иначе порядок обхода в коде приложения зависит от
      // случайных uuid, и seed не воспроизводит сценарий.
      let idn = 0;
      vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
        const h = (++idn).toString(16).padStart(12, '0');
        return `0000${seed.toString(16).padStart(4, '0')}-0000-4000-8000-${h}` as `${string}-${string}-${string}-${string}-${string}`;
      });
      const upd: string[] = [];
      const origUpd = LocalDocumentService.updateDocument.bind(LocalDocumentService);
      vi.spyOn(LocalDocumentService, 'updateDocument').mockImplementation(async (id, data) => {
        if (process.env.TRACE_DOC && id.endsWith(process.env.TRACE_DOC)) upd.push(`${activeDevice()?.name} updateDocument ${JSON.stringify({ t: data.trashedAt, seen: data.lastSeenCloudUpdatedAt?.slice(14, 23) })} after: ${log[log.length - 1]}`);
        return origUpd(id, data);
      });
      if (process.env.TRACE_CLOUD) {
        const pg = runner.interceptor.postgres;
        const origU = pg.executeUpdate.bind(pg);
        pg.executeUpdate = ((table, payload, filters) => {
          const r = origU(table, payload, filters);
          if (table === 'documents') for (const row of r.data ?? []) if (String(row.uuid).endsWith(process.env.TRACE_CLOUD!)) upd.push(`${activeDevice()?.name} CLOUD update ${JSON.stringify(Object.keys(payload))} trashed=${String(row.trashed_at ?? '')} up=${String(row.updated_at).slice(14, 23)} after: ${log[log.length - 1]}`);
          return r;
        }) as typeof pg.executeUpdate;
      }
      const offline = new Map<Device, boolean>([[A, false], [B, false]]);
      const setNet = (dev: Device) => {
        const off = offline.get(dev)!;
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => !off });
        if (off) { runner.interceptor.setStep('device_b_edit'); runner.interceptor.armFault('network_pre', 'device_b_edit'); }
        else { runner.interceptor.clearArmedFault(); runner.interceptor.setStep('initial_write'); }
      };
      const saved = new Set<string>();
      const log: string[] = [];
      let n = 0;

      for (let step = 0; step < STEPS; step++) {
        const dev = pick([A, B]);
        activateDevice(dev); setNet(dev);
        const db = await getLocalDb();
        const docs = (await db.getAll('documents')).filter(d => d.guestId === uid);
        // Порядок getAll идёт по случайным id — сортируем по тексту первой версии,
        // чтобы seed воспроизводил один и тот же сценарий.
        const label = new Map<string, string>();
        for (const d of docs) {
          const vs = await db.getAllFromIndex('versions', 'by-document', d.id);
          label.set(d.id, vs.sort((p, q) => p.version - q.version)[0]?.content ?? d.id);
        }
        const live = docs.filter(d => !d.trashedAt).sort((p, q) => label.get(p.id)!.localeCompare(label.get(q.id)!));
        const r = rnd();
        const text = `${dev.name}${seed}-${++n}`;
        const kind = (r < 0.2 || live.length === 0) ? 'new' : r < 0.55 ? 'edit' : r < 0.62 ? 'trash' : r < 0.85 ? 'sync' : 'net';
        try {
          if (r < 0.2 || live.length === 0) {
            await saveNewNote(uid, text);
            saved.add(text); log.push(`${dev.name}${offline.get(dev) ? '(off)' : ''} new ${text}`);
          } else if (r < 0.55) {
            const d = pick(live);
            await save(uid, d.id, text, Date.now());
            saved.add(text); log.push(`${dev.name}${offline.get(dev) ? '(off)' : ''} edit [${label.get(d.id)}] ${text}`);
          } else if (r < 0.62) {
            const d = pick(live);
            await StorageService.trashDocument(uid, d.id, d.linkedCloudId);
            log.push(`${dev.name} trash [${label.get(d.id)}]`);
          } else if (r < 0.85) {
            await syncRound(uid);
            log.push(`${dev.name}${offline.get(dev) ? '(off)' : ''} sync`);
          } else {
            offline.set(dev, !offline.get(dev));
            log.push(`${dev.name} ${offline.get(dev) ? 'goes offline' : 'back online'}`);
          }
          // I3 — после каждого шага: номер версии внутри заметки уникален.
          // Два разных текста под одним номером — один из них в облако не попадёт.
          const db2 = await getLocalDb();
          for (const d of (await db2.getAll('documents')).filter(x => x.guestId === uid)) {
            const nums = (await db2.getAllFromIndex('versions', 'by-document', d.id)).map(v => v.version);
            if (new Set(nums).size !== nums.length) {
              throw new Error(`I3: duplicate version numbers ${JSON.stringify(nums)} in ${d.id.slice(-4)} after: ${log[log.length - 1]}\n${log.join('\n')}`);
            }
          }
        } catch (e) {
          if ((e as Error).message.startsWith('I3:')) throw e;
          if (!offline.get(dev)) throw new Error(`online op failed: ${(e as Error).message}\n${log.join('\n')}`);
          // Офлайн сохранение может бросить после локальной записи — тогда текст
          // сохранён и обязан дожить до конца.
          if ((await allTexts(uid)).everything.has(text)) saved.add(text);
          log.push(`${dev.name}(off) ${kind} ${text} threw: ${(e as Error).message}${saved.has(text) ? ` (but ${text} is on the device)` : ''}`);
        }
      }

      offline.set(A, false); offline.set(B, false);
      // A, B, A, B, A, B, A — последнее слово за A, чтобы увидеть последнюю выгрузку B.
      for (const dev of [A, B, A, B, A, B, A]) { activateDevice(dev); setNet(dev); await syncRound(uid); }

      const dump = async () => {
        const db = await getLocalDb();
        const out: string[] = [];
        const q = await db.getAll('syncQueue');
        for (const d of (await db.getAll('documents')).filter(x => x.guestId === uid)) {
          const vs = (await db.getAllFromIndex('versions', 'by-document', d.id)).sort((p, q) => p.version - q.version);
          out.push(`  ${d.id.slice(-4)} uuid=${(d.uuid ?? '').slice(-4)} link=${(d.linkedCloudId ?? '').slice(-4)}${d.trashedAt ? ' TRASH' : ''}${d.localOnly ? ' localOnly' : ''} cv=${d.currentVersion} seen=${(d.lastSeenCloudUpdatedAt ?? '').slice(14, 23)} q=${q.filter(t => t.documentId === d.id).map(t => t.id.split('_')[0] + (t.dead ? '†' : '')).join('/')} [${vs.map(v => `${v.version}:${v.content}`).join(', ')}]`);
        }
        return out.join('\n');
      };
      activateDevice(A); const a = await allTexts(uid); const dumpA = await dump();
      activateDevice(B); const b = await allTexts(uid); const dumpB = await dump();
      const cloudDump = runner.interceptor.postgres.getRows('documents').map(d => `  ${String(d.uuid).slice(-4)}${d.trashed_at ? ' TRASH' : ''}${d.deleted_at ? ' DEL' : ''} cv=${d.current_version} up=${String(d.updated_at ?? '').slice(14, 23)} [${runner.interceptor.postgres.getRows('versions').filter(v => v.document_uuid === d.uuid).map(v => `${v.version}:${v.content}`).join(', ')}]`).join('\n');
      if (upd.length) log.push(`--- trace:\n${upd.join('\n')}`);
      log.push(`--- A:\n${dumpA}\n--- B:\n${dumpB}\n--- cloud:\n${cloudDump}`);
      const cloud = new Set(runner.interceptor.postgres.getRows('versions').map(v => String(v.content)));
      const lost = [...saved].filter(t => !a.everything.has(t) && !b.everything.has(t) && !cloud.has(t));
      expect(lost, `I1: saved texts lost\n${log.join('\n')}`).toEqual([]);
      const liveA = [...a.byUuid.values()].sort(), liveB = [...b.byUuid.values()].sort();
      expect(liveB, `I2: devices diverge\n${log.join('\n')}`).toEqual(liveA);
    }, 60_000);
  }
});
