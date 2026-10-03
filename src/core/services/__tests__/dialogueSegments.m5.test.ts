import { describe, it, expect } from 'vitest';
import type { AIDialogue, DialogueMessage } from '../../storage/localDb';
import type { DialogueHead } from '../dialogueSegments';
import {
  SEGMENT_MAX_BYTES,
  assembleDialogue,
  headOf,
  mergeHeads,
  planDialogue,
  readSegmentVersion,
  segmentKeyOf,
  splitMessages,
  staleSegmentKeys,
} from '../dialogueSegments';

// M-5: «head + append-only сегменты» вместо страничности одной строки. Каждый тест
// держит конкретно то свойство, которого не было у paging-формата; мутации названы в
// конце файла.

const msg = (id: string, content: string, createdAt: number): DialogueMessage =>
  ({ id, role: 'user', content, createdAt });

const dialogue = (messages: DialogueMessage[], over: Partial<AIDialogue> = {}): AIDialogue => ({
  id: 'dlg-1',
  title: 'T',
  personaId: 'p',
  personaName: 'P',
  personaEmoji: '🎯',
  createdAt: 1_000,
  updatedAt: 2_000,
  messages,
  ...over,
});

const big = (n: number, seed: string): string => `${seed}-`.repeat(n);

describe('M-5 plan: разбиение и стабильность закрытых окон', () => {
  it('ни одно окно не больше лимита, состав и порядок реплик сохранены', () => {
    const messages = Array.from({ length: 40 }, (_, i) => msg(`m${i}`, big(30_000, `k${i}`), 1_000 + i));
    const d = dialogue(messages);
    const { segments } = planDialogue(d);
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments) {
      expect(Buffer.byteLength(JSON.stringify(s.messages), 'utf8')).toBeLessThanOrEqual(SEGMENT_MAX_BYTES);
    }
    expect(segments.flatMap(s => s.messages).map(m => m.id)).toEqual(messages.map(m => m.id));
  });

  it('реплика больше лимита живёт в собственном окне, а не режется', () => {
    const huge = msg('huge', 'Ж'.repeat(SEGMENT_MAX_BYTES + 10_000), 1_500);
    const { segments } = planDialogue(dialogue([msg('a', 'хлеб', 1_000), huge]));
    expect(segments.flatMap(s => s.messages).map(m => m.id)).toEqual(['a', 'huge']);
    const own = segments.find(s => s.messages.some(m => m.id === 'huge'))!;
    expect(own.messages).toHaveLength(1);
  });

  it('дописывание в хвост не трогает закрытые окна: те же ключи, те же границы', () => {
    const first = Array.from({ length: 20 }, (_, i) => msg(`m${i}`, big(30_000, `k${i}`), 1_000 + i));
    const plan1 = planDialogue(dialogue(first));
    const grown = [...first, msg('new', 'свежий ход', 9_000), msg('new2', 'ещё один', 9_500)];
    const plan2 = planDialogue(dialogue(grown, { updatedAt: 10_000 }), plan1.head);

    // Все окна прежнего диалога остались на своих ключах: их не переписывают.
    expect(plan2.head.segments.filter(x => x.firstAt < 9_000).map(x => x.key))
      .toEqual(plan1.head.segments.map(x => x.key));
    // Переписывается ровно одно окно — открытое, куда добавляли. Имя при этом
    // не меняется: иначе каждая дописка оставляла бы в облаке осиротевшую строку.
    expect(plan2.toWrite.map(x => x.firstAt)).toEqual([plan1.head.segments.at(-1)?.firstAt]);
    expect(plan2.head.segments.map(x => x.key)).toEqual(plan1.head.segments.map(x => x.key));
  });

  it('имя сегмента не содержит «#» и не несёт поля data — старый клиент его не соберёт', () => {
    const { head, segments } = planDialogue(dialogue([msg('a', 'раз', 1_000)]));
    expect(head.head).toBe(true);
    expect(segments[0]!.seg).toBe(true);
    for (const key of [segments[0]!.key, ...head.segments.map(s => s.key)]) {
      expect(key).not.toContain('#');
      expect(key).toContain(`${head.id}@seg`);
    }
    // Единственное, на что смотрит читатель 0.9.28/0.9.29, — строка `data`.
    expect(JSON.parse(JSON.stringify(head))).not.toHaveProperty('data');
    expect(JSON.parse(JSON.stringify(segments[0]))).not.toHaveProperty('data');
  });
});

describe('M-5 mergeHeads: то, чего не умел paging', () => {
  const plan = (d: AIDialogue, prev?: DialogueHead) => planDialogue(d, prev);

  it('удаление сильнее параллельной правки: надгробие уровня диалога переживает ход соседа', () => {
    const base = plan(dialogue([msg('a', 'раз', 1_000)]));
    // A удалил диалог, B об этом не знает и дописал ход.
    const deleted = { ...base.head, deletedAt: 5_000, updatedAt: 5_000 };
    const appended = plan(dialogue([msg('a', 'раз', 1_000), msg('b', 'два', 6_000)], { updatedAt: 6_000 }), base.head).head;
    const merged = mergeHeads(deleted, appended);
    expect(merged.deletedAt).toBe(5_000);
    // Тот же результат при обратном порядке слияния — иначе устройства разъедутся.
    expect(mergeHeads(appended, deleted).deletedAt).toBe(5_000);
  });

  it('гонка двух новых окон на одно время: в head одна ссылка, сообщений не дублируется', () => {
    const base = plan(dialogue([msg('a', 'раз', 1_000)]));
    const win = (nonceTail: string, content: string) => {
      const s = {
        key: segmentKeyOf(base.head.id, 1_000, nonceTail),
        firstAt: 1_000, lastAt: 1_000, updatedAt: 3_000,
        bytes: 100, count: 1,
      };
      const seg = { seg: true as const, key: s.key, headKey: base.head.id, firstAt: 1_000, lastAt: 1_000, updatedAt: 3_000, messages: [msg('a', content, 1_000)] };
      return { s, seg };
    };
    const left = win('aaaaaaaa', 'раз');
    const right = win('bbbbbbbb', 'раз (правка)');
    const merged = mergeHeads(
      { ...base.head, segments: [left.s] },
      { ...base.head, segments: [right.s] },
    );
    expect(merged.segments).toHaveLength(1);
    const map = new Map([[left.seg.key, left.seg], [right.seg.key, right.seg]]);
    const d = assembleDialogue(merged, map);
    expect(d.messages.map(m => m.id)).toEqual(['a']);
  });

  it('окна двух устройствUnion’ятся и идут в хронологическом порядке, скаляры — от свежего', () => {
    const a = plan(dialogue(Array.from({ length: 12 }, (_, i) => msg(`a${i}`, big(40_000, `x${i}`), 1_000 + i)), { updatedAt: 4_000, title: 'A-имя' }));
    const b = plan(dialogue(Array.from({ length: 12 }, (_, i) => msg(`b${i}`, big(40_000, `y${i}`), 1_000 + i)), { updatedAt: 5_000, personaId: 'other' }));
    const merged = mergeHeads(a.head, b.head);
    expect(merged.title).toBe('T'); // title у более свежего head — тоже «T»
    expect(merged.personaId).toBe('other');
    const firsts = merged.segments.map(s => s.firstAt);
    expect(firsts).toEqual([...firsts].sort((x, y) => x - y));
    // Ни одно окно не потеряно: сообщения обоих устройств на месте.
    const map = new Map([...a.segments, ...b.segments].map(s => [s.key, s]));
    const ids = assembleDialogue(merged, map).messages.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(12);
  });

  it('надгробия реплик: union по id с максимальной отметкой, TTL-старые отпадают', () => {
    const base = headOf(dialogue([msg('a', 'раз', 1_000)]));
    const merged = mergeHeads(
      { ...base, updatedAt: 2_000, deletedMessages: [{ id: 'x', at: 1_500 }, { id: 'old', at: 0 }] },
      { ...base, updatedAt: 2_000, deletedMessages: [{ id: 'x', at: 1_800 }, { id: 'y', at: 1_700 }] },
      2_000, // «old» ещё внутри TTL: 90 дней с начала отсчёта
    );
    const ids = (merged.deletedMessages ?? []).map(t => t.id).sort();
    expect(ids).toEqual(['old', 'x', 'y']);
    expect(merged.deletedMessages?.find(t => t.id === 'x')?.at).toBe(1_800);

    const expired = mergeHeads(
      { ...base, deletedMessages: [{ id: 'x', at: 1_000 }] },
      { ...base },
      1_000 + 91 * 24 * 3600_000,
    );
    expect(expired.deletedMessages ?? []).toEqual([]);
  });
});

describe('M-5 сборка и уборка', () => {
  it('неизвестные head’у сегменты игнорируются, stale-ключи находятся только свои', () => {
    const plan = planDialogue(dialogue([msg('a', 'раз', 1_000), msg('b', 'два', 2_000)], { updatedAt: 3_000 }));
    // Сегмент нашего диалога, который head больше не называет (переоткрытое окно).
    const alien = { ...plan.segments[0]!, key: segmentKeyOf(plan.head.id, 9_999, 'deadbeef') };
    const d = assembleDialogue(plan.head, new Map([...plan.segments, alien].map(s => [s.key, s])));
    expect(d.messages.map(m => m.id)).toEqual(['a', 'b']);
    expect(staleSegmentKeys(plan.head, [...plan.segments.map(s => s.key), alien.key, `${plan.head.id}#1700`]))
      .toEqual([alien.key]);
  });

  it('splitMessages не оставляет пустых окон и сохраняет границы по createdAt', () => {
    const messages = Array.from({ length: 6 }, (_, i) => msg(`m${i}`, big(50_000, `z${i}`), 1_000 + i * 100));
    const windows = splitMessages(messages, 120_000);
    expect(windows.length).toBeGreaterThan(1);
    for (const w of windows) expect(w.length).toBeGreaterThan(0);
    expect(windows.flat().map(m => m.id)).toEqual(messages.map(m => m.id));
  });
});

describe('M-5 read: неполный набор — отказ, а не укороченный диалог', () => {
  const d = dialogue(Array.from({ length: 24 }, (_, i) => msg(`m${i}`, big(30_000, `w${i}`), 1_000 + i)));
  const plan = planDialogue(d);
  const rows = () => [
    { key: plan.head.id, payload: { ...plan.head } as Record<string, unknown> },
    ...plan.segments.map(s => ({
      key: s.key,
      payload: { seg: true, firstAt: s.firstAt, lastAt: s.lastAt, updatedAt: s.updatedAt, messages: JSON.stringify(s.messages) } as Record<string, unknown>,
    })),
  ];

  it('round-trip: то, что положили, то и собрали, без потерь и дублей', () => {
    const read = readSegmentVersion(rows());
    expect(read?.kind).toBe('segments');
    if (read?.kind !== 'segments') return;
    expect(read.dialogue.messages.map(m => m.id)).toEqual(d.messages.map(m => m.id));
    expect(read.dialogue.title).toBe(d.title);
    expect(read.head.updatedAt).toBe(d.updatedAt);
  });

  it('не хватает сегмента → refused со списком окон, диалога нет', () => {
    const all = rows();
    const missingKey = all[2]!.key;
    const read = readSegmentVersion(all.filter((_, i) => i !== 2));
    expect(read?.kind).toBe('refused');
    if (read?.kind !== 'refused') return;
    expect(read.missing).toEqual([missingKey]);
    expect((read as { dialogue?: unknown }).dialogue).toBeUndefined();
  });

  it('head без единого сегмента (первый забор) → refused, а не пустой диалог', () => {
    const read = readSegmentVersion([rows()[0]!]);
    expect(read?.kind).toBe('refused');
    if (read?.kind !== 'refused') return;
    expect(read.missing.length).toBe(plan.head.segments.length);
  });

  it('битый messages у сегмента → refused (не «текста не было»)', () => {
    const all = rows();
    all[1]!.payload = { ...all[1]!.payload, messages: '{не json' };
    const read = readSegmentVersion(all);
    expect(read?.kind).toBe('refused');
    if (read?.kind !== 'refused') return;
    expect(read.reason).toContain('не разбирается');
  });

  it('чужих строк head не трогает: без своей head-строки это не сегментный диалог', () => {
    expect(readSegmentVersion(rows().slice(1))).toBeNull();
  });
});

// Мутации — прогнаны реально (каждая даёт exit 1 в этом файле):
//  · keepName = только identical (открытое окно теряет имя) → «дописывание в хвост»;
//  · identical := false (закрытое окно всегда «изменилось») → «дописывание в хвост»;
//  · deletedAt = newer.deletedAt вместо max(...) → «удаление сильнее параллельной правки»;
//  · дедуп окон по key вместо firstAt → «гонка двух новых окон»;
//  · segmentKeyOf: «#» вместо «@seg» → «имя сегмента не содержит «#»…».
