import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance, LocalDraft } from '../../../../core/storage/localDb';
import { WritingDraftService, decideDraftCopy } from '../WritingDraftService';
import { DataProvider } from '../../../../core/data';

// SF-2 (ревью `sync-step0`): миграция 0043 перенесла `drafts.updated_at` на часы
// сервера, а `loadDraft` по-прежнему сравнивал её с локальным `updatedAt`, которое
// придумывают часы устройства (`buildLocalDraft`: `updatedAt: Date.now()`). До 0043
// оба штампа были с ОДНИХ часов — сравнение было честным, просто слабым. После 0043
// на устройстве, чьи часы отстают больше чем на 60 с, облачный черновик при
// перезагрузке побеждает ВСЕГДА: облачную копию писатель отправляет только на
// заметных изменениях и не чаще раза в 30 с, значит последние минуты набора всегда
// новее в облаке по серверным часам и старее по локальной отметке. Локальный текст
// перезаписывается через `saveToLocal` — последний набор теряется.
//
// Правка: спор решается серверными штампами с обеих сторон. После принятой облачной
// записи устройство запоминает `updated_at` этой версии (как `markCloudSeen` у
// заметок); при перезагрузке облако побеждает только если его метка НОВЕЕ запомненной,
// и не имеет значения, что часы прибора отстают. Без запомненной метки (черновики до
// правки) остаётся прежние часы — переходный путь, специально проверён ниже.
//
// Харнесс боевой: настоящий `DataProvider` → настоящий провайдер `drafts`, подменён
// только клиент PostgREST. Отметку возвращает сервер, а не тест.

const UID = 'u_sf2_draft';
const MIN = 60_000;
/** Серверные часы идут на пять минут вперёд против часов этого прибора. */
const SKEW = 5 * MIN;
const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);

type DraftRow = {
  user_id: string;
  content: string;
  title: string | null;
  word_count: number | null;
  updated_at: string;
};

let drafts: DraftRow[];
/** Отметки, какие отдавал «сервер» на записях, по порядку. */
let serverStamps: number[];
/** Одна следующая запись падает — так устроена проверка отказа. */
let failNextWrite: Error | undefined;

const serverNow = () => Date.now() + SKEW;

class Q {
  private f: Array<[string, unknown]> = [];
  private single = false;
  private ins: Record<string, unknown> | null = null;
  private upd: Record<string, unknown> | null = null;
  private del = false;

  constructor(private readonly table: string) {}

  select() { return this; }
  upsert(row: Record<string, unknown>) { this.ins = row; return this; }
  insert(row: Record<string, unknown>) { this.ins = row; return this; }
  update(patch: Record<string, unknown>) { this.upd = patch; return this; }
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
      if (failNextWrite) {
        const err = failNextWrite;
        failNextWrite = undefined;
        return Promise.resolve({ data: null, error: err });
      }
      const one = this.ins;
      // Триггер 0043: метку ряда пишет сервер, клиентскую выбрасываем.
      const stamp = serverNow();
      serverStamps.push(stamp);
      const row: DraftRow = {
        user_id: String(one.user_id),
        content: String(one.content ?? ''),
        title: (one.title as string | null | undefined) ?? null,
        word_count: (one.word_count as number | null | undefined) ?? null,
        updated_at: new Date(stamp).toISOString(),
      };
      drafts = drafts.filter(r => r.user_id !== row.user_id);
      drafts.push(row);
      // .select('updated_at').maybeSingle() — PostgREST отвечает телом только когда
      // его попросили; отсутствие select в запросе видно по returned === null.
      const data = this.single ? { updated_at: row.updated_at } : [{ updated_at: row.updated_at }];
      return Promise.resolve({ data, error: null });
    }
    if (this.del) {
      drafts = drafts.filter(r => !this.match(r));
      return Promise.resolve({ data: null, error: null });
    }
    if (this.upd) {
      const hits = drafts.filter(r => this.match(r));
      for (const r of hits) {
        Object.assign(r, this.upd);
        const stamp = serverNow();
        serverStamps.push(stamp);
        r.updated_at = new Date(stamp).toISOString();
      }
      return Promise.resolve({ data: this.single ? (hits[0] ?? null) : hits, error: null });
    }
    const hits = drafts.filter(r => this.match(r));
    return Promise.resolve({ data: this.single ? (hits[0] ?? null) : hits, error: null });
  }
}

vi.mock('../../../../core/supabase/client', () => ({
  getSupabase: () => ({ from: (table: string) => new Q(table), rpc: () => Promise.resolve({ data: null, error: null }) }),
}));

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  isProfileLoaded: () => true,
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

function draft(content: string, wordCount: number, updatedAt: number, extra: Partial<LocalDraft> = {}): LocalDraft {
  return {
    userId: UID, owner: UID, title: '', content, seconds: 60, wpm: 40, wordCount,
    pinnedThoughts: [], tags: [], activeSessionId: null, savedDocumentId: null,
    updatedAt, ...extra,
  };
}

async function stored(): Promise<Record<string, unknown> | undefined> {
  const db = await getLocalDb(UID);
  return await db.get('drafts', UID) as unknown as Record<string, unknown> | undefined;
}

const cloudRow = () => drafts.find(r => r.user_id === UID);
/** Последняя метка, поставленная «сервером». Её отсутствие — ошибка настройки теста. */
const lastStamp = (): number => {
  const s = serverStamps.at(-1);
  if (s === undefined) throw new Error('сервер не ставил меток — тест настроен неверно');
  return s;
};

describe('SF-2: спор черновика решают серверные штампы с обеих сторон', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    drafts = [];
    serverStamps = [];
    failNextWrite = undefined;
    localStorage.clear();
    sessionStorage.clear();
    resetDbInstance();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    // fake-indexeddb переживает resetDbInstance: строку черновика нужно стирать
    // самим, иначе следующий тест прочитает отметку прежнего прогона.
    await (await getLocalDb(UID)).delete('drafts', UID);
    WritingDraftService.bumpDraftGeneration(UID);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDbInstance();
  });

  // Мутация: в `loadDraft` вернуть прежнюю ветку `Math.abs(localTs - cloudTs)` →
  // красный на этом же тесте (облако побеждает из-за отставания часов).
  it('часы отстают на пять минут: дописанный после облачной записи текст цел', async () => {
    const v1 = draft('первый-набор', 10, T0);
    await WritingDraftService.saveToLocal(v1);
    expect(await WritingDraftService.saveDraftToCloud(v1)).toBe(true);
    const seen = lastStamp();
    expect(cloudRow()?.updated_at).toBe(new Date(seen).toISOString());

    // Человек печатает ещё минуту по своим часам; облако за это время не писали
    // (дебаунс и потолок 30 с на заметных изменениях).
    const v2 = draft('первый-набор плюс дописано', 12, T0 + MIN);
    await WritingDraftService.saveToLocal(v2);

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'облако не ушло вперёд от запомненной версии — локальный текст цел').toBe(v2.content);

    const after = await stored();
    expect(String(after?.content), 'и в локальном кэше тоже').toBe(v2.content);
  });

  it('облако ушло вперёд (правка другого устройства) — приезжает облачная копия', async () => {
    const v1 = draft('первый-набор', 10, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);
    await WritingDraftService.saveToLocal(draft('дописано', 12, T0 + MIN));

    // Второе устройство выгрузило свою версию той же строки: серверная метка
    // стала новее запомненной.
    vi.setSystemTime(T0 + 3 * MIN);
    await DataProvider.saveDraft(UID, { userId: UID, content: 'с-другого-устройства', title: null, wordCount: 30 });
    const cloudStamp = lastStamp();

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'облако правда новее — оно побеждает, как и раньше').toBe('с-другого-устройства');
    expect(Number((await stored())?._cloudUpdatedAt), 'принятая копия запоминает новую метку').toBe(cloudStamp);
  });

  it('принятая запись запоминает СЕРВЕРНЫЙ штамп, а не часы прибора', async () => {
    const v1 = draft('текст', 5, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);

    const stamped = await stored();
    expect(typeof stamped?._cloudUpdatedAt, 'после принятой облачной записи отметка обязана появиться').toBe('number');
    expect(Number(stamped?._cloudUpdatedAt)).toBe(lastStamp());
    expect(Number(stamped?._cloudUpdatedAt), 'часы прибора в отметку не попадают').toBeGreaterThan(T0);
  });

  it('отказ облачной записи ничего не запоминает', async () => {
    const v1 = draft('текст-отказ', 5, T0);
    await WritingDraftService.saveToLocal(v1);
    // Разрыв ответа: сервер не ответил — это «не знаю», а не «облако видели».
    failNextWrite = new Error('network down');
    await expect(WritingDraftService.saveDraftToCloud(v1)).rejects.toThrow('network down');
    expect((await stored())?._cloudUpdatedAt, 'отказ не имеет права двигать отметку').toBeUndefined();

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'облако не прочитано — локальная копия остаётся').toBe('текст-отказ');
  });

  it('черновик без запомненной отметки (переходный путь) судится прежними часами', async () => {
    // Локальная копия есть, облачной записи этого устройства никогда не было —
    // сравнивать серверные штампы не с чем, работает прежнее правило.
    await WritingDraftService.saveToLocal(draft('локальный-старый', 5, T0 - 10 * MIN));
    drafts = [{
      user_id: UID, content: 'облачный-свежее', title: null, word_count: 50,
      updated_at: new Date(T0).toISOString(),
    }];

    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded?.content, 'прежнее правило: облако новее по часам — оно и приезжает').toBe('облачный-свежее');
    expect(Number((await stored())?._cloudUpdatedAt), 'принятая облачная копия запоминает свою метку')
      .toBe(T0);
  });

  it('повторная перезагрузка не гоняет черновик по кругу', async () => {
    const v1 = draft('первый-набор', 10, T0);
    await WritingDraftService.saveToLocal(v1);
    await WritingDraftService.saveDraftToCloud(v1);
    await WritingDraftService.saveToLocal(draft('дописано', 12, T0 + MIN));

    const first = await WritingDraftService.loadDraft(UID);
    expect(first?.content).toBe('дописано');
    const second = await WritingDraftService.loadDraft(UID);
    expect(second?.content, 'второй забор обязан дать то же самое').toBe('дописано');
  });

  it('провайдер: saveDraft возвращает метку ряда, которую поставил сервер', async () => {
    const stamp = await DataProvider.saveDraft(UID, { userId: UID, content: 'x', title: null, wordCount: 1 });
    expect(stamp).toBe(serverNow());
    expect(cloudRow()?.updated_at).toBe(new Date(Number(stamp)).toISOString());
  });

  it('правило целиком: где серверные метки, а где переходные часы', () => {
    // Запомненная метка решает одна, без часов прибора.
    expect(decideDraftCopy({ cloudSeen: 100, cloudTs: 101, localTs: 10_000, localWords: 1, cloudWords: 1 })).toBe('cloud');
    expect(decideDraftCopy({ cloudSeen: 100, cloudTs: 100, localTs: 1, localWords: 1, cloudWords: 999 })).toBe('local');
    expect(decideDraftCopy({ cloudSeen: 100, cloudTs: 0, localTs: 1, localWords: 1, cloudWords: 1 }),
      'метку облака не прочитали — «не знаю» не переворачивает локальную копию').toBe('local');
    // Без запомненной метки — прежние часы и прежний коридор wordCount.
    expect(decideDraftCopy({ cloudSeen: null, cloudTs: 500_000, localTs: 400, localWords: 1, cloudWords: 1 })).toBe('cloud');
    expect(decideDraftCopy({ cloudSeen: null, cloudTs: 500, localTs: 480, localWords: 3, cloudWords: 5 })).toBe('cloud');
    expect(decideDraftCopy({ cloudSeen: null, cloudTs: 500, localTs: 480, localWords: 5, cloudWords: 3 })).toBe('local');
  });
});
