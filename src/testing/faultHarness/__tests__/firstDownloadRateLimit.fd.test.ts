import { describe, it, expect, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import type { InMemoryPostgres } from '../inMemoryPostgres';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { CloudSyncService, rateLimitTuning } from '../../../core/services/CloudSyncService';
import { SyncService } from '../../../core/services/SyncService';
import { DocumentService } from '../../../core/services/DocumentService';
import { VersionService } from '../../../core/services/VersionService';
import { getLocalDb } from '../../../core/storage/localDb';

/**
 * FD (02.11): первая загрузка на свежее устройство упирается в лимит сервера.
 * Владелец: ~211 заметок, ~355 `GET /rest/v1/documents?…uuid=eq.<id>` за минуту,
 * nginx `rest_limit` отбил 237+17 в `429`, заметки остались «только в облаке».
 *
 * Здесь тот же профиль: N = 150 заметок в облаке, лимит K = 100 запросов за окно,
 * дальше сервер отвечает 429 ровно как nginx (только `message`, без `code` —
 * замер на стенде). Ожидание: ОДИН вход (оба прохода, как в проде) выгружает все
 * 150, `failed = 0`, лишних чтений строки нет, дублей нет.
 */

const N = 150;
const K = 100;

function seedCloudNote(pg: InMemoryPostgres, uid: string, uuid: string, text: string): void {
  pg.executeInsert('documents', {
    uuid, user_id: uid, title: `Note ${uuid}`, current_version: 1, total_words: 1,
    total_duration: 1, sessions_count: 1, tags: [], _encrypted: false,
    first_session_at: '2026-01-01T00:00:00Z', last_session_at: '2026-01-01T00:00:00Z',
  });
  pg.executeInsert('versions', {
    document_uuid: uuid, user_id: uid, version: 1, content: text, word_count: 1,
    duration: 1, wpm: 1, _encrypted: false,
    saved_at: '2026-01-01T00:00:00Z', session_started_at: '2026-01-01T00:00:00Z',
  });
}

async function localNoteCount(uid: string): Promise<number> {
  const db = await getLocalDb();
  return (await db.getAll('documents')).filter(d => d.guestId === uid && !d.trashedAt && d.localOnly !== true).length;
}

describe('FD: первая загрузка против 429 (N=150, K=100)', () => {
  const runner = new LifecycleRunner();

  afterEach(() => {
    rateLimitTuning.baseMs = 2_000;
    rateLimitTuning.maxMs = 16_000;
    rateLimitTuning.maxAttempts = 6;
    runner.interceptor.clearRateLimit();
    runner.interceptor.clearArmedFault();
    runner.teardown();
    forgetDevice();
    vi.restoreAllMocks();
  });

  it('один вход выгружает все 150 заметок, `failed = 0`, без дублей и лишних чтений', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_fd_429';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;

    for (let i = 0; i < N; i++) seedCloudNote(pg, uid, `fd_note_${i}`, `текст заметки ${i}`);

    // Счёт чтений одной и той же строки по uuid (FD-3, FD-4) — обёртка, которая
    // считает и передаёт вызов оригиналу: подмена на null сломала бы выгрузку.
    const readsByUuid = new Map<string, number>();
    const originalGetDocument = DocumentService.getDocument.bind(DocumentService);
    vi.spyOn(DocumentService, 'getDocument').mockImplementation(async (u: string, id: string) => {
      readsByUuid.set(id, (readsByUuid.get(id) ?? 0) + 1);
      return originalGetDocument(u, id);
    });

    // Окно 3 с, K=100: 150 заметок дают ~156 запросов, поэтому стена из 429
    // обязана случиться (есть проверка ниже). Ревью FD: окно в 1 с под нагрузкой
    // полного vitest растягивалось, стены не было, и тест краснел не по делу. Пауза чуть длиннее окна — иначе
    // повтор попадает в то же окно и тест проверяет не «подождать и повторить».
    // Прода-значения (2 → 16 с против минуты nginx) тут не нужны: проверяется
    // порядок, а не длина сна.
    runner.interceptor.setRateLimit(K, 3_000);
    rateLimitTuning.baseMs = 3_100;
    rateLimitTuning.maxMs = 6_200;
    rateLimitTuning.maxAttempts = 8;
    pg.resetRequestCounts();

    // Оба прохода, как после входа на проде: забор по rev и фоновый полный проход.
    await SyncService.pullNotes(uid);
    const res = await CloudSyncService.restoreMissingDocuments(uid, { force: true });

    const failed = (res as { failed?: number }).failed ?? -1;
    const local = await localNoteCount(uid);
    const totalRequests = pg.getRequestCount();
    const duplicates = Array.from(readsByUuid.entries()).filter(([, c]) => c > 1);

    console.log(JSON.stringify({
      local, failed, hasMore: res.hasMore, totalRequests,
      uuidReads: readsByUuid.size, duplicates: duplicates.length, blockedByLimit: runner.interceptor.getRateLimitBlocked(),
    }));

    // FD-2: лимит действительно должен был сработать — иначе тест проверяет
    // выгрузку без стены 429 и ничего не гарантирует.
    expect(runner.interceptor.getRateLimitBlocked(), 'сервер обязан был отбить хотя бы один запрос')
      .toBeGreaterThan(0);
    // FD-2: лимит не должен стоить заметок — все N становятся локальными за один вход.
    expect(local, `локально ${local} из ${N} после одного входа`).toBe(N);
    // FD-1: отбитые скачивания — не «полный проход».
    expect(failed, 'failed должен быть виден наружу и быть нулём').toBe(0);
    expect(res.hasMore, 'после успешной выгрузки проход не «неполный»').toBe(false);
    // FD-3: на N новых заметок — N чтений версий + страницы списков + небольшая константа.
    expect(totalRequests, `всего запросов к базе: ${totalRequests}`).toBeLessThanOrEqual(N + 20);
    // FD-4: одна строка не читается дважды за загрузку.
    expect(duplicates, `дубли чтений: ${JSON.stringify(duplicates.slice(0, 5))}`).toEqual([]);
  }, 180_000);

  it('FD-4: два прохода одновременно не качают одну заметку дважды', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_fd_429_concurrent';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    for (let i = 0; i < N; i++) seedCloudNote(pg, uid, `fd4_note_${i}`, `текст ${i}`);

    // Как на проде: фоновый полный проход (useBackgroundSync.ts:96) и забор по rev
    // (SyncService.pullNotes) стартуют в одном тике и идут параллельно.
    const addCalls = new Map<string, number>();
    const originalAdd = CloudSyncService.addLocalCopy.bind(CloudSyncService);
    vi.spyOn(CloudSyncService, 'addLocalCopy').mockImplementation(async (...args: Parameters<typeof CloudSyncService.addLocalCopy>) => {
      addCalls.set(args[1], (addCalls.get(args[1]) ?? 0) + 1);
      return originalAdd(...args);
    });

    runner.interceptor.setRateLimit(K, 3_000);
    rateLimitTuning.baseMs = 3_100;
    rateLimitTuning.maxMs = 6_200;
    rateLimitTuning.maxAttempts = 8;
    pg.resetRequestCounts();

    // Ревью FD: шпион ставится ДО параллельной фазы — иначе он мерил только третий,
    // последовательный проход, и «ноль двойных чтений» ничего не доказывал.
    const versionReads = new Map<string, number>();
    const originalVersions = VersionService.getVersions.bind(VersionService);
    vi.spyOn(VersionService, 'getVersions').mockImplementation(async (u: string, docId: string, ...rest: unknown[]) => {
      versionReads.set(docId, (versionReads.get(docId) ?? 0) + 1);
      return originalVersions(u as never, docId as never, ...(rest as []));
    });
    await Promise.all([
      SyncService.pullNotes(uid),
      CloudSyncService.restoreMissingDocuments(uid, { force: true }),
    ]);

    const local = await localNoteCount(uid);
    const db = await getLocalDb();
    const rows = (await db.getAll('documents')).filter(d => d.guestId === uid && !d.trashedAt);
    const byLinked = new Map<string, number>();
    for (const r of rows) byLinked.set(String(r.linkedCloudId ?? ''), (byLinked.get(String(r.linkedCloudId ?? '')) ?? 0) + 1);
    const doubleCopies = Array.from(byLinked.entries()).filter(([, c]) => c > 1);
    const repeated = Array.from(addCalls.entries()).filter(([, c]) => c > 1);
    // Что считается дублем: ДВОЙНОЕ ОБЛАЧНОЕ ЧТЕНИЕ заметки, а не повторный вход
    // в `addLocalCopy`. Ревью FD: одновременный второй вход не ждёт замка —
    // `queueOnHeld: false` отдаёт ему LOCK_HELD сразу; последовательный — выходит
    // на проверке `existing`, не трогая облако.
    // Повторный проход после первого: облако больше не читается вовсе.
    await CloudSyncService.restoreMissingDocuments(uid, { force: true });

    const doubleVersionReads = Array.from(versionReads.entries()).filter(([, c]) => c > 1);

    console.log(JSON.stringify({
      local, distinctAddTargets: addCalls.size, repeatedAddInvocations: repeated.length,
      doubleCopies: doubleCopies.length, doubleVersionReads: doubleVersionReads.length,
      totalRequests: pg.getRequestCount(),
    }));

    expect(local, `локально ${local} из ${N}`).toBe(N);
    expect(doubleCopies, `двойных локальных копий: ${JSON.stringify(doubleCopies.slice(0, 5))}`).toEqual([]);
    // Двойное чтение законно только как повтор после 429 (FD-2) — не больше, чем
    // сервер отбил запросов.
    const extraReads = doubleVersionReads.reduce((n, [, c]) => n + (c - 1), 0);
    expect(extraReads, `заметок, скачанных из облака дважды: ${JSON.stringify(doubleVersionReads.slice(0, 5))}`)
      .toBeLessThanOrEqual(runner.interceptor.getRateLimitBlocked());
  }, 180_000);
});
