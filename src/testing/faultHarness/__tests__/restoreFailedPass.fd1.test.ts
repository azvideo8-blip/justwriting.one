import { describe, it, expect, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import type { InMemoryPostgres } from '../inMemoryPostgres';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { CloudSyncService, rateLimitTuning } from '../../../core/services/CloudSyncService';

/**
 * FD-1: проход, у которого облако отбило скачивания, не считается полным.
 * Раньше `failed` из `downloadAllFromCloud` наружу не выходил, и `hasMore`
 * зависел только от `incomplete` (нечитаемые строки списка) — суточная отметка
 * `notes_restore_done_date_<uid>` ставилась после прохода, где 200 из 211
 * заметок так и не скачались.
 */

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

describe('FD-1: отбитые скачивания = неполный проход', () => {
  const runner = new LifecycleRunner();
  afterEach(() => {
    rateLimitTuning.baseMs = 2_000;
    rateLimitTuning.maxMs = 16_000;
    rateLimitTuning.maxAttempts = 6;
    runner.interceptor.clearRateLimit();
    runner.teardown();
    forgetDevice();
  });

  it(`failed выходит наружу, hasMore=true, и отметка листинга не глушит повтор на полчаса`, async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_fd1_failed';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    for (let i = 0; i < 8; i++) seedCloudNote(pg, uid, `fd1_note_${i}`, `текст ${i}`);

    // Листинг проходит (первый запрос), скачивания упираются в лимит.
    runner.interceptor.setRateLimit(1, 60 * 60 * 1000);
    // Окно на час и лимит в 1 запрос: повторы заведомо исчерпываются, паузы
    // тесту не нужны — только их порядок.
    rateLimitTuning.baseMs = 5;
    rateLimitTuning.maxMs = 10;
    rateLimitTuning.maxAttempts = 3;

    const res = await CloudSyncService.restoreMissingDocuments(uid, { force: true });

    expect(res.failed, 'отбитые лимитом скачивания обязаны быть видны').toBeGreaterThan(0);
    expect(res.hasMore, 'проход с отбитыми — не полный').toBe(true);

    const ts = Number(localStorage.getItem(`last_restore_listing_ts_${uid}`));
    const ageMin = (Date.now() - ts) / 60_000;
    // Неполному проходу остаётся короткое окно (5 мин), а не 30.
    expect(ageMin, `отметка листинга записана на ${ageMin.toFixed(1)} мин назад`).toBeGreaterThanOrEqual(20);
    expect(ageMin).toBeLessThan(30);
  });

  it(`полный проход оставляет окно листинга полным (30 мин)`, async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_fd1_clean';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    for (let i = 0; i < 4; i++) seedCloudNote(pg, uid, `fd1_ok_${i}`, `текст ${i}`);

    const res = await CloudSyncService.restoreMissingDocuments(uid, { force: true });

    expect(res.failed).toBe(0);
    expect(res.hasMore).toBe(false);
    const ageMin = (Date.now() - Number(localStorage.getItem(`last_restore_listing_ts_${uid}`))) / 60_000;
    expect(ageMin, 'полный проход — свежая отметка').toBeLessThan(1);
  });

  it(`упавший проход (список отбит лимитом до конца) — то же короткое окно, а не повтор каждые 120 с (ревью FD)`, async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_fd1_throws';
    await runner.setup();
    const uid = runner.userId;
    seedCloudNote(runner.interceptor.postgres, uid, 'fd1_throw_0', 'текст');
    runner.interceptor.setRateLimit(0, 60 * 60 * 1000);
    rateLimitTuning.baseMs = 5;
    rateLimitTuning.maxMs = 10;
    rateLimitTuning.maxAttempts = 2;

    await expect(CloudSyncService.restoreMissingDocuments(uid, { force: true })).rejects.toBeTruthy();
    const raw = localStorage.getItem(`last_restore_listing_ts_${uid}`);
    expect(raw, 'отметка листинга записана и при сбое').not.toBeNull();
    const ageMin = (Date.now() - Number(raw)) / 60_000;
    expect(ageMin).toBeGreaterThanOrEqual(20);
    expect(ageMin).toBeLessThan(30);
  });
});

