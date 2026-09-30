import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentService } from '../DocumentService';
import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';
import * as encryptModule from '../../crypto/encrypt';

/**
 * Частичная правка метаданных не должна оставлять строку наполовину
 * зашифрованной.
 *
 * Признак `_encrypted` у строки один на все поля. `updateTags` шифровал только
 * теги и вместе с ними ставил `_encrypted = true`. На строке, которая до этого
 * лежала открытым текстом (заметка, созданная до сейфа и не дошедшая до
 * миграции), заголовок оставался открытым, а строка уже звалась зашифрованной:
 * чтение пыталось расшифровать заголовок и падало — «Не удалось прочитать».
 * Миграция такую строку пропускает (признак стоит), так что это навсегда.
 *
 * Строки здесь кладутся в таблицу руками, в том виде, в каком они лежали до
 * сейфа. «Создать через приложение и отредактировать» этого не ловит:
 * приложение при включённом сейфе открытых строк не пишет.
 */

type Row = Record<string, unknown>;
const table: Row[] = [];
const requests: string[] = [];

vi.mock('../../supabase/client', () => ({
  getSupabase: () => ({
    from(name: string) {
      if (name !== 'documents') throw new Error(`Unexpected table: ${name}`);
      let op: 'select' | 'update' = 'select';
      let patch: Row = {};
      const filters: Array<(r: Row) => boolean> = [];
      const hits = () => table.filter(r => filters.every(f => f(r)));
      const run = () => {
        requests.push(op);
        const rows = hits();
        if (op === 'update') for (const r of rows) Object.assign(r, patch);
        return { data: rows.map(r => ({ ...r })), error: null };
      };
      const q = {
        select: () => q,
        update: (p: Row) => { op = 'update'; patch = p; return q; },
        eq: (col: string, val: unknown) => { filters.push(r => r[col] === val); return q; },
        is: (col: string, val: unknown) => { filters.push(r => (r[col] ?? null) === val); return q; },
        maybeSingle: async () => { const { data, error } = run(); return { data: data[0] ?? null, error }; },
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
      };
      return q;
    },
  }),
}));

const USER = 'user-legacy';
const DOC = 'doc-legacy';

/** Строка до сейфа: открытый текст, признака шифрования нет. */
const legacyRow = (extra: Row = {}): Row => ({
  uuid: DOC, user_id: USER, title: 'Письмо себе', tags: [], mood: null, label_id: null,
  current_version: 1, total_words: 3, total_duration: 60, sessions_count: 1,
  first_session_at: '2025-01-01T00:00:00.000Z', last_session_at: '2025-01-01T00:00:00.000Z',
  excluded_from_ai: false, _encrypted: false, deleted_at: null, ...extra,
});

const stored = () => table.find(r => r.uuid === DOC)!;

/** Инвариант строки: помечена зашифрованной — значит открытого текста в ней нет. */
function expectNoPlaintext(row: Row, plain: { title: string; tags: string[]; mood?: string }) {
  expect(row._encrypted).toBe(true);
  // AES-GCM: 12 байт IV + 16 байт метки — даже пустая строка даёт 40 знаков base64.
  expect(typeof row.title === 'string' && row.title.length >= 40).toBe(true);
  expect(row.title).not.toBe(plain.title);
  expect(typeof row.tags).toBe('string');
  if (plain.mood !== undefined) {
    expect(row.mood).not.toBe(plain.mood);
    expect(typeof row.mood === 'string' && row.mood.length >= 40).toBe(true);
  }
}

describe('partial metadata update on a row that is still plaintext', () => {
  beforeEach(async () => {
    table.length = 0;
    requests.length = 0;
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, true);
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    vi.spyOn(encryptModule, 'getSessionKey').mockReturnValue(key);
  });

  it('updateTags keeps the title readable and leaves no plaintext behind', async () => {
    table.push(legacyRow());

    await DocumentService.updateTags(USER, DOC, ['дом']);

    expectNoPlaintext(stored(), { title: 'Письмо себе', tags: ['дом'] });
    const doc = await DocumentService.getDocument(USER, DOC);
    expect(doc?._decryptionError).toBeFalsy();
    expect(doc?.title).toBe('Письмо себе');
    expect(doc?.tags).toEqual(['дом']);
  });

  // Ровно так это и было замечено на стенде: пустой заголовок, тегов нет —
  // строка читалась, пока к ней не добавили тег.
  it('updateTags on a row with an empty title does not make it unreadable', async () => {
    table.push(legacyRow({ title: '' }));
    expect((await DocumentService.getDocument(USER, DOC))?._decryptionError).toBeFalsy();

    await DocumentService.updateTags(USER, DOC, ['дом']);

    const doc = await DocumentService.getDocument(USER, DOC);
    expect(doc?._decryptionError).toBeFalsy();
    expect(doc?.title).toBe('');
    expect(doc?.tags).toEqual(['дом']);
  });

  // Чтение такую строку терпело (массив тегов и эмодзи настроения читаются как
  // есть), поэтому поломки видно не было — а открытые теги оставались в облаке
  // под признаком «зашифровано», и миграция их уже не трогала.
  it('updateTitle does not leave plaintext tags and mood under an "encrypted" flag', async () => {
    table.push(legacyRow({ tags: ['развод', 'долги'], mood: '😢' }));

    await DocumentService.updateTitle(USER, DOC, 'Новое имя');

    expectNoPlaintext(stored(), { title: 'Новое имя', tags: ['развод', 'долги'], mood: '😢' });
    const doc = await DocumentService.getDocument(USER, DOC);
    expect(doc?.title).toBe('Новое имя');
    expect(doc?.tags).toEqual(['развод', 'долги']);
    expect(doc?.mood).toBe('😢');
  });

  it('updateMetadata does not leave a plaintext mood behind', async () => {
    table.push(legacyRow({ mood: '😢' }));

    await DocumentService.updateMetadata(USER, DOC, { title: 'Новое имя', tags: ['дом'] });

    expectNoPlaintext(stored(), { title: 'Новое имя', tags: ['дом'], mood: '😢' });
    expect((await DocumentService.getDocument(USER, DOC))?.mood).toBe('😢');
  });

  // Обратный перекос: настроение уходило шифротекстом, а признак не ставился —
  // строка с шифротекстом под «не зашифровано» тоже нечитаема.
  it('a mood written after a session does not leave ciphertext under a plaintext flag', async () => {
    table.push(legacyRow());

    await DocumentService.updateDocumentAfterSession(USER, DOC, {
      totalWords: 10, totalDuration: 120, currentVersion: 2, mood: '😊', sessionsCount: 2,
    });

    expectNoPlaintext(stored(), { title: 'Письмо себе', tags: [], mood: '😊' });
    const doc = await DocumentService.getDocument(USER, DOC);
    expect(doc?._decryptionError).toBeFalsy();
    expect(doc?.title).toBe('Письмо себе');
    expect(doc?.mood).toBe('😊');
    expect(doc?.totalWords).toBe(10);
  });

  // Обычный случай не должен подорожать: строка уже зашифрована — один запрос.
  it('costs one request on a row that is already encrypted', async () => {
    table.push(legacyRow());
    await DocumentService.updateTitle(USER, DOC, 'Имя'); // приводит строку в порядок
    requests.length = 0;

    await DocumentService.updateTags(USER, DOC, ['дом']);
    await DocumentService.updateTitle(USER, DOC, 'Другое имя');

    expect(requests).toEqual(['update', 'update']);
    const doc = await DocumentService.getDocument(USER, DOC);
    expect(doc?.title).toBe('Другое имя');
    expect(doc?.tags).toEqual(['дом']);
  });

  it('does nothing to a missing row or a tombstone, as before', async () => {
    await expect(DocumentService.updateTags(USER, DOC, ['дом'])).resolves.toBeUndefined();
    expect(table).toEqual([]);

    const tombstone = legacyRow({ title: '', deleted_at: '2026-01-01T00:00:00.000Z' });
    table.push(tombstone);
    await DocumentService.updateTags(USER, DOC, ['дом']);
    expect(stored()).toEqual(tombstone);
  });
});
