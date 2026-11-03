import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance, LocalDraft } from '../../../../core/storage/localDb';
import { WritingDraftService } from '../WritingDraftService';
import { DataProvider } from '../../../../core/data';
import { generateDataKey, setSessionKey, clearSessionKey } from '../../../../core/crypto/encrypt';
import { maybeEncrypt, setEncryptionEnabled, setProfileLoaded } from '../../../../core/crypto/cryptoHelpers';

/**
 * SF3-7 (ревью, раунд 3): спеки SF2-1/SF3-1 подменяли `maybeEncrypt`/`maybeDecrypt`
 * тождеством, и круг хэшей черновика — «в облаке лежит НАША нагрузка, ответ
 * потерян» — ни разу не проверялся на настоящем шифротексте. А сверяется именно
 * он: `saveDraftToCloud` считает хэш по ОТКРЫТОЙ подписи до шифрования, а
 * `loadDraft` — по расшифрованной облачной копии. Разойдись хоть одно поле
 * (`_encrypted` не доехал, тег стал строкой, `null` пропал в `toDb`) — и признак
 * `cloudIsOurs` молча гаснет: своя же дошедшая запись снова затирает набранное.
 *
 * Здесь те же сценарии на боевых помощниках: AES-GCM на ключе сейфа, `_encrypted`
 * в ряду, `content` в облаке — шифротекст.
 */

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
let UID = 'u_sf37_0';
let caseNo = 0;
/** Серверные часы (триггер 0043) идут на пять минут вперёд против часов прибора. */
let skew = 5 * MIN;

type DraftRow = Record<string, unknown> & { user_id: string; updated_at: string };

let drafts: DraftRow[];
/** Следующая запись доходит до сервера, но ответ теряется. */
let loseNextResponse = false;

const serverNow = () => Date.now() + skew;

class Q {
  private f: Array<[string, unknown]> = [];
  private single = false;
  private projected: string | null = null;
  private ins: Record<string, unknown> | null = null;
  private del = false;

  constructor(private readonly table: string) {}

  select(cols?: string) { this.projected = cols ?? null; return this; }
  upsert(row: Record<string, unknown>) { this.ins = row; return this; }
  delete() { this.del = true; return this; }
  eq(col: string, val: unknown) { this.f.push([col, val]); return this; }
  maybeSingle() { this.single = true; return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  like() { return this; }
  gt() { return this; }
  lt() { return this; }

  then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
    return this.run().then(onFulfilled, onRejected);
  }

  private match(r: DraftRow): boolean {
    return this.f.every(([col, val]) => (r as unknown as Record<string, unknown>)[col] === val);
  }

  private run(): Promise<{ data: unknown; error: unknown }> {
    if (this.table !== 'drafts') return Promise.resolve({ data: this.single ? null : [], error: null });
    if (this.ins) {
      const stamp = serverNow();
      const row = this.applyWrite({ ...this.ins, updated_at: new Date(stamp).toISOString() });
      if (loseNextResponse) {
        loseNextResponse = false;
        // Запись СОВЕРШИЛАСЬ на сервере, ответа человек не увидел.
        return Promise.resolve({ data: null, error: new Error('response lost after commit') });
      }
      const projection = this.projected === 'updated_at' ? { updated_at: row.updated_at } : row;
      return Promise.resolve({ data: this.single ? projection : [projection], error: null });
    }
    if (this.del) {
      drafts = drafts.filter(r => !this.match(r));
      return Promise.resolve({ data: null, error: null });
    }
    const hits = drafts.filter(r => this.match(r));
    if (!this.single) return Promise.resolve({ data: hits, error: null });
    const one = hits[0] ?? null;
    if (one && this.projected === 'updated_at') return Promise.resolve({ data: { updated_at: one.updated_at }, error: null });
    return Promise.resolve({ data: one, error: null });
  }

  /** upsert по первичному ключу: одна строка на аккаунт. */
  private applyWrite(patch: Record<string, unknown>): DraftRow {
    const uid = String(patch.user_id ?? UID);
    const previous = drafts.find(r => r.user_id === uid);
    const next: DraftRow = { ...(previous ?? {}), ...patch, user_id: uid } as DraftRow;
    drafts = drafts.filter(r => r.user_id !== uid);
    drafts.push(next);
    return next;
  }
}

vi.mock('../../../../core/supabase/client', () => ({
  getSupabase: () => ({ from: (table: string) => new Q(table), rpc: () => Promise.resolve({ data: null, error: null }) }),
}));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
// ШИФРОВАНИЕ НЕ мокано: `cryptoHelpers` и `encrypt` работают настоящими.

function draft(content: string, wordCount: number, updatedAt: number): LocalDraft {
  return {
    userId: UID, owner: UID, title: 'заголовок', content, seconds: 60, wpm: 40, wordCount,
    pinnedThoughts: ['мысль'], tags: ['тег'], activeSessionId: null, savedDocumentId: null,
    updatedAt,
  };
}

async function stored(): Promise<Record<string, unknown> | undefined> {
  const db = await getLocalDb(UID);
  return await db.get('drafts', UID) as unknown as Record<string, unknown> | undefined;
}

const cloudRow = (): DraftRow | undefined => drafts.find(r => r.user_id === UID);

describe('SF3-7: круг хэшей черновика на настоящем шифровании', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    UID = `u_sf37_${caseNo++}`;
    drafts = [];
    loseNextResponse = false;
    skew = 5 * MIN;
    localStorage.clear();
    sessionStorage.clear();
    resetDbInstance();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await (await getLocalDb(UID)).delete('drafts', UID);
    WritingDraftService.bumpDraftGeneration(UID);
    clearSessionKey();
    setProfileLoaded(UID, true);
    setEncryptionEnabled(UID, true);
    setSessionKey(await generateDataKey());
  });

  afterEach(() => {
    vi.useRealTimers();
    clearSessionKey();
    resetDbInstance();
  });

  // Мутация: считать `draftPayloadHash` по зашифрованной копии (то есть без
  // расшифровки на чтении) → красный: облачный ряд перестаёт узнаваться как свой,
  // и своя же дошедшая запись затирает набранное после потерянного ответа.
  it('облако шифровано, хэш — по содержимому: свой ряд узнан, набор цел', async () => {
    const v1 = draft('первый-набор', 3, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);

    vi.setSystemTime(T0 + MIN);
    const v2 = draft('первый-набор и ещё', 6, T0 + MIN);
    await WritingDraftService.saveToLocal(v2);
    loseNextResponse = true;
    await expect(WritingDraftService.saveDraftToCloud(v2)).rejects.toThrow(/response lost/);

    const row = cloudRow();
    expect(row, 'дошедшая запись лежит в облаке').toBeDefined();
    expect(row?._encrypted, 'ряд помечен зашифрованным — флаг доехал').toBe(true);
    expect(String(row?.content), 'текст в облаке — шифротекст').not.toContain('первый-набор');
    expect(String((await stored())?.content), 'локальная копия осталась открытой прибору').toBe(v2.content);

    vi.setSystemTime(T0 + 2 * MIN);
    const v3 = draft('первый-набор и ещё плюс последние слова', 9, T0 + 2 * MIN);
    await WritingDraftService.saveToLocal(v3);

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'расшифрованная копия = наша отправка: локальный набор цел').toBe(v3.content);
    expect(String((await stored())?.content), 'и в кэше').toBe(v3.content);

    const again = await WritingDraftService.loadDraft(UID);
    expect(again?.content, 'второй забор даёт то же самое').toBe(v3.content);
  });

  // Мутация: та же — хэш по шифротексту. Красной становится ПРОВЕРКА различения:
  // чужой расшифрованный ряд не совпадёт ни с одной нашей отправкой, и без
  // расшифровки на чтении он был бы неотличим от своего.
  it('чужая зашифрованная копия приезжает и становится нашей базой', async () => {
    const v1 = draft('первый-набор', 3, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);
    const sentBefore = (await stored())?._cloudSentHashes;
    expect(Array.isArray(sentBefore), 'список отправок запомнен').toBe(true);

    // Другое устройство того же аккаунта: свой черновик, тот же ключ сейфа.
    vi.setSystemTime(T0 + 3 * MIN);
    const other = draft('чужой-набор-с-другого-прибора', 40, T0 + 3 * MIN);
    const enc = await maybeEncrypt(other as unknown as Record<string, unknown>, ['content', 'title'], ['pinnedThoughts', 'tags'], UID);
    await DataProvider.saveDraft(UID, {
      userId: UID, content: enc.content, title: enc.title, wordCount: other.wordCount,
      pinnedThoughts: enc.pinnedThoughts, tags: enc.tags, _encrypted: true,
    });
    expect(String(cloudRow()?.content), 'чужая копия уехала шифром').not.toContain('чужой-набор');

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'после принятой записи локальных правок нет — берём облако').toBe('чужой-набор-с-другого-прибора');

    const accepted = await stored();
    expect(accepted?._cloudSentHashes, 'принятая копия закрывает список одной отправкой').toEqual([accepted?._cloudAckedHash]);
    expect(typeof accepted?._cloudUpdatedAt, 'и запоминает серверную метку').toBe('number');
    expect(Number(accepted?._cloudUpdatedAt), 'метка — с часов сервера, а не прибора').toBe(serverNow());
  });
});
