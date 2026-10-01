import { randomUUID } from './localDb';
import type { AIDialogue, DialogueMessage } from './localDb';

// S-29: слияние двух реплик одного диалога вместо last-writer-wins.
// Прежнее правило («облако свежее — перезаписать») молча теряло ход того
// устройства, которое ответило вторым. S-34: модуль живёт в core, потому что
// слияние нужно и перед выгрузкой (LocalStoreSyncService), а core не
// импортирует features.

/** S-37: маркер записи, сделанной клиентом с id реплик и отметками удаления. */
export const DIALOGUE_SCHEMA = 2 as const;

/**
 * S-37: отметка об удалении старше этого срока снимается — иначе список растёт
 * вечно (две записи на каждую перегенерацию у старых клиентов) и диалог у
 * предела в 4 МБ перестаёт выгружаться. Потолок: реплика, не выходившая в сеть
 * дольше 90 дней, может вернуть удалённую реплику из своей копии.
 */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function newMessageId(): string {
  return randomUUID();
}

// Идентичность реплики, написанной до S-29: (role, content, позиция). Оба
// устройства вычисляют одно и то же по одному и тому же префиксу, поэтому
// старый диалог сливается с самим собой без дублей. Текст участвует только
// при первом вычислении: писатели сохраняют выданный id в запись до любой
// правки на месте (S-36), дальше реплика живёт по сохранённому id.
const LEGACY_PREFIX = 'lg_';

function legacyMessageId(role: string, content: string, index: number): string {
  const s = [role, content, String(index)].join('\u0000');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return LEGACY_PREFIX + h.toString(16).padStart(8, '0') + '_' + index;
}

/** Репликам без id выдаёт детерминированный id; копии с id возвращает как есть. */
export function withMessageIds(d: AIDialogue): AIDialogue {
  if (d.messages.every(m => !!m.id)) return d;
  return {
    ...d,
    messages: d.messages.map((m, i) => m.id
      ? m
      : { ...m, id: legacyMessageId(m.role, m.content, i), createdAt: (d.createdAt ?? 0) + i }),
  };
}

/**
 * S-37: реплики без id (запись старого клиента, который режет массив без
 * отметок) подбираются к репликам второй стороны по роли и тексту, а не по
 * позиции: после удаления в середине позиции сдвинуты, и позиционный id дал бы
 * дубль каждой реплики за местом удаления. Непарные получают позиционный id.
 */
function adoptIds(x: AIDialogue, y: AIDialogue): AIDialogue {
  if (x.messages.every(m => !!m.id)) return x;
  const pool = y.messages.filter(m => m.id);
  const used = new Set<string>();
  return {
    ...x,
    messages: x.messages.map((m, i) => {
      if (m.id) return m;
      const match = pool.find(p => !used.has(p.id!) && p.role === m.role && p.content === m.content);
      if (!match) return { ...m, id: legacyMessageId(m.role, m.content, i), createdAt: (x.createdAt ?? 0) + i };
      used.add(match.id!);
      return { ...m, id: match.id, createdAt: match.createdAt };
    }),
  };
}

// Варианты одного ответа: союз списков в порядке появления, сначала у более
// свежей копии. ponytail: порядок союза при трёхстороннем слиянии зависит от
// порядка слияний (у вариантов нет своего времени создания); текущий ответ и
// его номер сходятся всегда, порядок листания — нет. Нужен строгий порядок —
// хранить у варианта момент создания.
function unionVariants(a?: string[], b?: string[]): string[] | undefined {
  if (!a && !b) return undefined;
  const out: string[] = [];
  for (const v of [...(a ?? []), ...(b ?? [])]) {
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

// S-36: побеждает более свежая копия реплики (updatedAt ставится при смене
// варианта и перегенерации). Ничья — детерминированно по тексту и вариантам,
// чтобы обе стороны выбрали одну и ту же копию.
function newerOf(x: DialogueMessage, y: DialogueMessage): [DialogueMessage, DialogueMessage] {
  const tx = x.updatedAt ?? 0;
  const ty = y.updatedAt ?? 0;
  if (tx !== ty) return tx > ty ? [x, y] : [y, x];
  const kx = [x.content, ...(x.variants ?? [])].join('\u0000');
  const ky = [y.content, ...(y.variants ?? [])].join('\u0000');
  return kx >= ky ? [x, y] : [y, x];
}

function mergePair(x: DialogueMessage, y: DialogueMessage): DialogueMessage {
  const [base, other] = newerOf(x, y);
  const variants = unionVariants(base.variants, other.variants);
  if (variants && !variants.includes(base.content)) variants.push(base.content);
  return {
    ...base,
    ...(variants ? { variants, variantIndex: variants.indexOf(base.content) } : {}),
    ...(base.reasoning === undefined && other.reasoning !== undefined ? { reasoning: other.reasoning } : {}),
  };
}

function lastExtractedIdOf(d: AIDialogue, merged: DialogueMessage[]): string | undefined {
  if (!d.lastExtractedMessageId) return undefined;
  return merged.some(m => m.id === d.lastExtractedMessageId) ? d.lastExtractedMessageId : undefined;
}

// S-36: ключ порядка в хвосте — ход, а не голая реплика: (createdAt вопроса,
// id вопроса, createdAt, id). Два хода с разных устройств в одну миллисекунду
// иначе перемешивались: вопрос A, вопрос B, ответ A, ответ B. Ключ считается
// из самой реплики, не из соседей в массиве и не из союза: ответ, чей вопрос
// удалён, иначе на разных репликах вставал по-разному, и слияние зависело от
// порядка аргументов. Писатели ставят ответу createdAt вопроса + 1 и turnId;
// без turnId (старые реплики, служебные) ход — свой createdAt.
type TurnKey = [number, string, number, string];

function turnKey(m: DialogueMessage): TurnKey {
  const at = m.createdAt ?? 0;
  if (m.role === 'user' && m.type !== 'system') return [at, m.id!, at, m.id!];
  return m.turnId ? [at - 1, m.turnId, at, m.id!] : [at, '', at, m.id!];
}

function compareKeys(x: TurnKey, y: TurnKey): number {
  for (let i = 0; i < 4; i++) {
    const a = x[i]!;
    const b = y[i]!;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v as object).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/** Содержимое записи без updatedAt, с устойчивым порядком ключей — для «а изменилось ли». */
export function dialogueFingerprint(d: AIDialogue): string {
  const { updatedAt: _u, ...rest } = d;
  return JSON.stringify(canonical(rest));
}

/**
 * союз реплик по id за минусом удалённых с обеих сторон; общий префикс хранит
 * порядок, хвост после расхождения сортируется по ходам (разные часы
 * переставляют хвост, но не уносят ход), скаляры — LWW по updatedAt.
 *
 * S-34: если результат отличается от облачной копии (`cloud`), updatedAt
 * ставится по часам сейчас и строго позже обоих входов — инкрементальный забор
 * на других устройствах берёт только `updatedAt > since`, и союз со старой
 * отметкой до них не доезжал. Совпал с облаком — отметка облака, иначе каждый
 * забор перезаписывал и выгружал бы запись заново.
 */
export function mergeDialogues(local: AIDialogue, cloud: AIDialogue, now = Date.now()): AIDialogue {
  const a = adoptIds(local, cloud);
  const b = adoptIds(cloud, local);
  const aNewer = (a.updatedAt ?? 0) >= (b.updatedAt ?? 0);
  const newer = aNewer ? a : b;
  const older = aNewer ? b : a;

  const tomb = new Map<string, number>();
  for (const t of [...(a.deletedMessages ?? []), ...(b.deletedMessages ?? [])]) {
    if (now - t.at > TOMBSTONE_TTL_MS) continue;
    tomb.set(t.id, Math.max(tomb.get(t.id) ?? 0, t.at));
  }

  let common = 0;
  while (common < a.messages.length && common < b.messages.length && a.messages[common]?.id === b.messages[common]?.id) common++;

  const seen = new Set<string>();
  const prefix: DialogueMessage[] = [];
  for (let i = 0; i < common; i++) {
    const mine = aNewer ? a.messages[i]! : b.messages[i]!;
    const theirs = aNewer ? b.messages[i]! : a.messages[i]!;
    if (!mine.id || tomb.has(mine.id) || seen.has(mine.id)) continue;
    seen.add(mine.id);
    prefix.push(mergePair(mine, theirs));
  }

  const tailSource = [...a.messages.slice(common), ...b.messages.slice(common)];
  const tailById = new Map<string, DialogueMessage>();
  for (const m of tailSource) {
    if (!m.id || tomb.has(m.id) || seen.has(m.id)) continue;
    const known = tailById.get(m.id);
    tailById.set(m.id, known ? mergePair(known, m) : m);
  }
  const tail = [...tailById.values()].sort((x, y) => compareKeys(turnKey(x), turnKey(y)));

  const messages = [...prefix, ...tail];
  const extracted = lastExtractedIdOf(newer, messages) ?? lastExtractedIdOf(older, messages);
  const deletedMessages = [...tomb].map(([id, at]) => ({ id, at })).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  const result: AIDialogue = {
    ...newer,
    messages,
    createdAt: Math.min(a.createdAt ?? 0, b.createdAt ?? 0),
    updatedAt: 0,
    schema: DIALOGUE_SCHEMA,
  };
  if (deletedMessages.length) result.deletedMessages = deletedMessages;
  else delete result.deletedMessages;
  if (extracted) result.lastExtractedMessageId = extracted;
  else delete result.lastExtractedMessageId;
  result.updatedAt = dialogueFingerprint(result) === dialogueFingerprint(b)
    ? (b.updatedAt ?? 0)
    : Math.max(now, (a.updatedAt ?? 0) + 1, (b.updatedAt ?? 0) + 1);
  return result;
}

/** Нужно писателям: id и момент создания ставятся при создании реплики. */
export function stampMessage(m: DialogueMessage, now = Date.now()): DialogueMessage {
  return { ...m, id: m.id ?? newMessageId(), createdAt: m.createdAt ?? now };
}
