import { describe, it, expect } from 'vitest';
import { mergeDialogues } from '../../../../core/storage/dialogueMerge';
import type { AIDialogue, DialogueMessage } from '../../../../core/storage/localDb';

// S-36: правки в общем хвосте сходятся (побеждает более свежая копия реплики,
// ничья — детерминированно), ходы из одной миллисекунды не перемешиваются, и
// слияние случайных историй трёх устройств коммутативно, ассоциативно,
// идемпотентно по содержимому и не теряет живых id.

const NOW = 1_700_000_000_000;

function dialogue(messages: DialogueMessage[], extra: Partial<AIDialogue> = {}): AIDialogue {
  return {
    id: 'd', title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    createdAt: 1000, updatedAt: 2000, messages, ...extra,
  };
}

function m(role: 'user' | 'assistant', id: string, content: string, createdAt: number, extra: Partial<DialogueMessage> = {}): DialogueMessage {
  return { role, id, content, createdAt, ...extra };
}

const P = [m('user', 'u0', 'Общий вопрос', 10), m('assistant', 'a0', 'Общий ответ', 11, { turnId: 'u0' })];

// Содержимое, по которому сравниваем результаты: id, текст, набор вариантов.
const norm = (d: AIDialogue) => d.messages.map(x => [x.id, x.content, [...(x.variants ?? [])].sort()]);

describe('S-36: edits in the shared tail converge', () => {
  it('the newer copy of a message wins, whichever side it is on', () => {
    const a = dialogue([...P, m('user', 'u1', 'Вопрос', 20), m('assistant', 'a1', 'old', 21, { turnId: 'u1', updatedAt: 100 })], { updatedAt: 3000 });
    const b = dialogue([...P, m('user', 'u1', 'Вопрос', 20), m('assistant', 'a1', 'new', 21, { turnId: 'u1', updatedAt: 200 })], { updatedAt: 2500 });

    expect(mergeDialogues(a, b, NOW).messages[3]?.content, 'локальная копия победила более свежую').toBe('new');
    expect(mergeDialogues(b, a, NOW).messages[3]?.content).toBe('new');
  });

  it('a tie on updatedAt resolves the same way on both sides', () => {
    const a = dialogue([...P, m('assistant', 'a1', 'alpha', 21, { turnId: 'u0', updatedAt: 100 })]);
    const b = dialogue([...P, m('assistant', 'a1', 'beta', 21, { turnId: 'u0', updatedAt: 100 })]);

    expect(mergeDialogues(a, b, NOW).messages[2]?.content).toBe(mergeDialogues(b, a, NOW).messages[2]?.content);
  });

  it('two turns from the same millisecond stay turn-by-turn, not question, question, answer, answer', () => {
    const a = dialogue([...P, m('user', 'ua', 'Вопрос A', 500), m('assistant', 'aa', 'Ответ A', 501, { turnId: 'ua' })]);
    const b = dialogue([...P, m('user', 'ub', 'Вопрос B', 500), m('assistant', 'ab', 'Ответ B', 501, { turnId: 'ub' })]);

    const ids = mergeDialogues(a, b, NOW).messages.map(x => x.id);
    expect([['u0', 'a0', 'ua', 'aa', 'ub', 'ab'], ['u0', 'a0', 'ub', 'ab', 'ua', 'aa']], `ходы перемешаны: ${JSON.stringify(ids)}`).toContainEqual(ids);
  });
});

// ponytail: свой mulberry32 вместо fast-check — зависимость ради одного теста.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Op = 'append' | 'regenerate' | 'switchVariant' | 'delete' | 'sync';

function history(seed: number): { devices: AIDialogue[]; tombstoned: Set<string>; ops: string[] } {
  const r = rng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
  let clock = NOW - 100_000;
  let n = 0;
  const tombstoned = new Set<string>();
  const ops: string[] = [];
  const devices = [0, 1, 2].map(() => dialogue(P.map(x => ({ ...x }))));
  // Часы общие и монотонные, но в 30 % случаев стоят — ходы с разных устройств
  // в одну миллисекунду. Одно устройство два хода в одну миллисекунду не пишет.
  const lastOn = [0, 0, 0];
  const tick = (di: number) => {
    if (r() < 0.7) clock += 2;
    const t = Math.max(clock, lastOn[di]! + 2);
    lastOn[di] = t;
    return t;
  };

  for (let step = 0; step < 24; step++) {
    const op = pick<Op>(['append', 'append', 'regenerate', 'switchVariant', 'delete', 'sync', 'sync']);
    const di = Math.floor(r() * 3);
    const d = devices[di]!;
    if (op === 'append') {
      const t = tick(di);
      n++;
      d.messages.push(m('user', `u${di}_${n}`, `Вопрос ${n}`, t), m('assistant', `a${di}_${n}`, `Ответ ${n}`, t + 1, { turnId: `u${di}_${n}` }));
      d.updatedAt = t;
      ops.push(`append@${di}`);
    } else if (op === 'regenerate') {
      const users = d.messages.filter(x => x.role === 'user' && x.type !== 'system');
      if (!users.length) continue;
      const u = pick(users);
      const ui = d.messages.indexOf(u);
      const a = d.messages[ui + 1];
      if (!a || a.role !== 'assistant') continue;
      const t = tick(di);
      n++;
      const content = `Перегенерация ${n}`;
      const variants = [...(a.variants ?? []), a.content, content].filter((v, i, arr) => arr.indexOf(v) === i);
      d.messages[ui + 1] = { ...a, content, variants, variantIndex: variants.indexOf(content), updatedAt: t };
      d.updatedAt = t;
      ops.push(`regenerate@${di}:${a.id}`);
    } else if (op === 'switchVariant') {
      const withVariants = d.messages.filter(x => (x.variants?.length ?? 0) > 1);
      if (!withVariants.length) continue;
      const a = pick(withVariants);
      const t = tick(di);
      const idx = Math.floor(r() * a.variants!.length);
      a.content = a.variants![idx]!;
      a.variantIndex = idx;
      a.updatedAt = t;
      d.updatedAt = t;
      ops.push(`switchVariant@${di}:${a.id}`);
    } else if (op === 'delete') {
      if (!d.messages.length) continue;
      const x = pick(d.messages);
      const t = tick(di);
      d.messages.splice(d.messages.indexOf(x), 1);
      d.deletedMessages = [...(d.deletedMessages ?? []), { id: x.id!, at: t }];
      d.updatedAt = t;
      tombstoned.add(x.id!);
      ops.push(`delete@${di}:${x.id}`);
    } else {
      const other = (di + 1 + Math.floor(r() * 2)) % 3;
      const merged = mergeDialogues(d, devices[other]!, tick(di));
      devices[di] = JSON.parse(JSON.stringify(merged)) as AIDialogue;
      devices[other] = JSON.parse(JSON.stringify(merged)) as AIDialogue;
      ops.push(`sync@${di}<->${other}`);
    }
  }
  return { devices, tombstoned, ops };
}

describe('S-36: property — random 3-device histories', () => {
  const seeds = Array.from({ length: 400 }, (_, i) => i + 1);

  it.each(seeds)('seed %i: merge is commutative, associative, idempotent on content; no live id lost', (seed) => {
    const { devices: [a, b, c], tombstoned, ops } = history(seed);
    const why = `ops: ${ops.join(' ')}`;

    const ab = mergeDialogues(a!, b!, NOW);
    const ba = mergeDialogues(b!, a!, NOW);
    expect(norm(ab), `не коммутативно; ${why}`).toEqual(norm(ba));

    const abc = mergeDialogues(ab, c!, NOW);
    const bc = mergeDialogues(b!, c!, NOW);
    const a_bc = mergeDialogues(a!, bc, NOW);
    expect(norm(abc), `не ассоциативно; ${why}`).toEqual(norm(a_bc));

    expect(norm(mergeDialogues(ab, ab, NOW)), `не идемпотентно; ${why}`).toEqual(norm(ab));

    const live = new Set<string>();
    for (const d of [a!, b!, c!]) for (const x of d.messages) if (!tombstoned.has(x.id!)) live.add(x.id!);
    const mergedIds = new Set(abc.messages.map(x => x.id!));
    for (const id of live) expect(mergedIds.has(id), `живая реплика ${id} потеряна; ${why}`).toBe(true);
    for (const id of tombstoned) expect(mergedIds.has(id), `удалённая реплика ${id} вернулась; ${why}`).toBe(false);
  });
});
