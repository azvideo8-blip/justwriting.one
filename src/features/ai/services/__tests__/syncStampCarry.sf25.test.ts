import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { carryCloudSyncFields, getLocalDb, resetDbInstance } from '../../../../core/storage/localDb';
import type { AIDialogue } from '../../../../core/storage/localDb';
import { AIDialogueService } from '../AIDialogueService';
import { AITimelineService } from '../AITimelineService';
import {
  CLOUD_STAMP_FIELD,
  CLOUD_BASE_HASH_FIELD,
  CLOUD_SENT_HASHES_FIELD,
} from '../../../../core/services/LocalStoreSyncService';
import { contentHash } from '../../../../core/utils/contentHash';

// SF2-5 (ревью `sync-step0`, раунд 2): два писателя стоят вне обёртки SF-5,
// потому что пишут через `tx.objectStore(...).put(...)` — прокси сохраняет
// синхронные поля только на `db.put`. Следствие: скаляр теряет `_cloudStampedAt`
// и возвращается ровно к классу F-1 — без базы `uploadScalar` читает облако и
// берёт ЕГО ТЕКУЩИЙ штамп своей базой, условие проходит по построению, и более
// новая чужая версия перетирается молча.
//
//  • AIDialogueService.generateClosingSummary — строка `aiDialogueEvents`
//    собирается заново (keyPath `dialogueId`, то есть запись на диалог) и
//    перезаписывает прежнюю событие-строку без отметки;
//  • AITimelineService.rebuildFromSummaries — `clear()` + свежие put: у всей
//    хронологии пропадают отметки, а пересобирается она часто (разбор заметки).
//
// Правка: перенос sync-полей — общим чистым помощником `carryCloudSyncFields`,
// тем же, чем живёт обёртка `put`; писатели в собственной транзакции зовут его
// явно. Хэш базы приносится только вместе с той же отметкой (SF2-2).

const UID = 'u_sf25';
const DID = 'd_sf25';

const chat = vi.fn();

vi.mock('../AIService', () => ({
  AIService: {
    extractChatMemory: async () => ({ ok: true, memories: [] }),
    chat: (...a: unknown[]) => chat(...a),
    embed: async () => ({ ok: false, error: 'off' }),
  },
}));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: UID, email: 'someone@example.com' }) }));
vi.mock('../../../../core/services/LocalStoreSyncService', async (importActual) => ({
  ...(await importActual<typeof import('../../../../core/services/LocalStoreSyncService')>()),
  LocalStoreSyncService: { scheduleStoreSync: vi.fn(), scheduleStoreDelete: vi.fn() },
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

function dialogue(): AIDialogue {
  return {
    id: DID, title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    createdAt: 1000, updatedAt: 2000,
    messages: [
      { role: 'user', id: 'm1', content: 'о чём говорить', createdAt: 1000 },
      { role: 'assistant', id: 'm2', content: 'вот что', createdAt: 1100 },
      { role: 'user', id: 'm3', content: 'и ещё', createdAt: 1200 },
      { role: 'assistant', id: 'm4', content: 'итого' , createdAt: 1300 },
    ],
  } as AIDialogue;
}

describe('SF2-5: писатели вне db.put не теряют серверную отметку', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    resetDbInstance();
    const db = await getLocalDb(UID);
    await db.clear('aiDialogues');
    await db.clear('aiDialogueEvents');
    await db.clear('aiTimeline');
    await db.clear('aiSummaries');
    chat.mockResolvedValue({ ok: true, text: 'итог диалога' });
  });

  afterEach(() => { resetDbInstance(); });

  // Мутация: вернуть в AIDialogueService прежний put свежего объекта → красный
  // «отметка и хэши предыдущей строки доезжают».
  it('событие диалога при новом итоге сохраняет отметку прежней строки', async () => {
    const db = await getLocalDb(UID);
    await db.put('aiDialogues', dialogue());
    const stamp = 1_700_000_000_123;
    const previous = {
      dialogueId: DID, date: '2026-10-18', month: '2026-10', personaId: 'coach', personaName: 'Коуч',
      summary: 'прежний итог', themes: [],
      [CLOUD_STAMP_FIELD]: stamp,
      [CLOUD_BASE_HASH_FIELD]: 'aaaa0000bbbb1111',
      [CLOUD_SENT_HASHES_FIELD]: ['aaaa1111bbbb2222', 'cccc2222dddd3333'],
    };
    await db.put('aiDialogueEvents', previous as never);

    await AIDialogueService.generateClosingSummary(DID);

    const row = await db.get('aiDialogueEvents', DID) as unknown as Record<string, unknown>;
    expect(row?.summary, 'итог обновился').toBe('итог диалога');
    expect(row?.[CLOUD_STAMP_FIELD], 'серверная отметка не потеряна').toBe(stamp);
    expect(row?.[CLOUD_BASE_HASH_FIELD], 'хэш базы живёт вместе со своей отметкой').toBe(previous[CLOUD_BASE_HASH_FIELD]);
    expect(row?.[CLOUD_SENT_HASHES_FIELD], 'неподтверждённые отправки тоже перенесены').toEqual(previous[CLOUD_SENT_HASHES_FIELD]);
  });

  it('пересборка хронологии сохраняет отметки строк, а не обнуляет их', async () => {
    const db = await getLocalDb(UID);
    const docId = 'doc-1';
    const stamp = 1_700_000_000_456;
    const summary = {
      documentId: docId, summary: 'содержание', extractedFacts: ['факт'], tone: 'ровно',
      themes: ['тема'], insights: [], updatedAt: 1000,
    };
    await db.put('aiSummaries', summary as never);
    await db.put('documents', {
      id: docId, guestId: UID, title: 'З', tags: [], firstSessionAt: 1000, lastSessionAt: 1_700_000_000_000,
      currentVersion: 1, createdAt: 1000,
    } as never);
    // Строка хронологии от прошлой пересборки — со штампом принятой облачной версии.
    await db.put('aiTimeline', {
      documentId: docId, date: '2026-10-18', month: '2026-10', facts: [], themes: [], insights: [],
      [CLOUD_STAMP_FIELD]: stamp,
      [CLOUD_BASE_HASH_FIELD]: 'eeee4444ffff5555',
      [CLOUD_SENT_HASHES_FIELD]: ['gggg6666hhhh7777'],
    } as never);

    const count = await AITimelineService.rebuildFromSummaries();
    expect(count, 'строка пересобрана').toBe(1);

    const row = await db.get('aiTimeline', docId) as unknown as Record<string, unknown>;
    expect(row[CLOUD_STAMP_FIELD], 'отметка переживает clear() + put').toBe(stamp);
    expect(row[CLOUD_BASE_HASH_FIELD], 'и хэш той же версии').toBe('eeee4444ffff5555');
    expect(row[CLOUD_SENT_HASHES_FIELD], 'и след неподтверждённой отправки').toEqual(['gggg6666hhhh7777']);
  });

  it('помощник переносит хэш базы только вместе с той же отметкой', async () => {
    const prev = {
      id: 'x',
      [CLOUD_STAMP_FIELD]: 111,
      [CLOUD_BASE_HASH_FIELD]: contentHash('облачное-содержимое-111'),
    };
    // Писатель принёс СВОЮ отметку другой версии — чужой хэш базы брать нельзя.
    const foreign = { id: 'x', [CLOUD_STAMP_FIELD]: 222 };
    const carried = carryCloudSyncFields(foreign, prev);
    expect(carried[CLOUD_STAMP_FIELD]).toBe(222);
    expect(carried[CLOUD_BASE_HASH_FIELD], 'хэш базы не переезжает на чужую отметку').toBeUndefined();

    // Писатель не принёс ничего — пара (отметка + хэш) переезжает целиком.
    const plain = { id: 'x' };
    const pair = carryCloudSyncFields(plain, prev);
    expect(pair[CLOUD_STAMP_FIELD]).toBe(111);
    expect(pair[CLOUD_BASE_HASH_FIELD]).toBe(prev[CLOUD_BASE_HASH_FIELD]);
  });
});
