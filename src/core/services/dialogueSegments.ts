// M-5: диалог хранится НЕ страницами одной строки, а «головой» и append-only
// сегментами.
//
// Почему: в paging-формате один логический объект размазан по 1 + N строкам, и ни
// одна из них не является истиной — версию задаёт отдельный манифест. Отсюда три
// класса багов, которые мы чиним по отдельности третий раунд: обрыв между страницами
// и манифестом (M-1), столкновение ключей страниц между попытками (M-2), и формы,
// которые старый клиент умеет собирать неверно (M-3). Плюс удаление диалога не
// переживает параллельную правку, потому что «надгробие» живёт в большой строке,
// которую надо ещё суметь прочитать (находка 11).
//
// Здесь: head (`key`) — маленькая строка с метаданными, надгробиями и СПИСКОМ
// сегментов; сегмент (`key@seg<firstAt>-<nonce>`) — отдельная строка с целым куском
// сообщений. Закрытый сегмент (упёрся в лимит) не переписывается никогда, значит его
// слияние тривиально; сливается только открытый хвост. Любая запись — это CAS одной
// строки, перехода «половина записана» в принципе нет.
import type { AIDialogue, DialogueMessage } from '../storage/localDb';
import { DIALOGUE_SCHEMA, TOMBSTONE_TTL_MS } from '../storage/dialogueMerge';

/** 400 КБ, а не 500: запас на то, что envelope (id, отметки, nonce) доезжает в той же
 *  строке, и на рост variants у последней реплики. */
export const SEGMENT_MAX_BYTES = 400 * 1024;

export interface SegmentRef {
  key: string;
  /** Время первой реплики окна — оно идентично у всех версий этого окна. */
  firstAt: number;
  lastAt: number;
  updatedAt: number;
  bytes: number;
  count: number;
}

export interface DialogueHead {
  head: true;
  id: string;
  createdAt: number;
  updatedAt: number;
  schema: typeof DIALOGUE_SCHEMA;
  title: string;
  personaId: string;
  personaName: string;
  personaEmoji: string;
  documentId?: string | undefined;
  responseLength?: AIDialogue['responseLength'];
  reasoning?: boolean | undefined;
  closingSummary?: string | undefined;
  archivedAt?: number | undefined;
  /** S-58: надгробие уровня диалога. Живёт в head, а head читается всегда. */
  deletedAt?: number | undefined;
  deletedMessages?: { id: string; at: number }[] | undefined;
  lastExtractedMessageId?: string | undefined;
  segments: SegmentRef[];
}

export interface DialogueSegment {
  seg: true;
  key: string;
  headKey: string;
  firstAt: number;
  lastAt: number;
  updatedAt: number;
  messages: DialogueMessage[];
}

const encoder = new TextEncoder();
const bytes = (s: string): number => encoder.encode(s).length;

export function newSegmentNonce(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

/** '@' вместо '#': клиенты 0.9.28/0.9.29 режут ключ по последней «#» и вообще не
 *  считают такую строку страницей. Плюс у строки нет поля `data` — вторая линия той
 *  же защиты (M-3): читатель, не нашедший текста, переходит дальше, а не пишет
 *  фантом. */
export function segmentKeyOf(headKey: string, firstAt: number, nonce: string): string {
  return `${headKey}@seg${firstAt}-${nonce}`;
}

/**
 * Разбивает сообщения на окна ≤ limit. Жадно и по границам реплик: реплика неделима
 * (разрезать сообщение — значит потерять id, варианты и надгробие). Реплика больше
 * лимита живёт в собственном окне — иначе диалог с одним гигантским ответом не
 * выгружается никогда (ровно то, что делали 600-килобайтовые ответы в тестах).
 */
export function splitMessages(messages: DialogueMessage[], limit = SEGMENT_MAX_BYTES): DialogueMessage[][] {
  const windows: DialogueMessage[][] = [];
  let current: DialogueMessage[] = [];
  let currentBytes = 2; // '[]'
  for (const m of messages) {
    const size = bytes(JSON.stringify(m));
    if (current.length > 0 && currentBytes + size + 1 > limit) {
      windows.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(m);
    currentBytes += size + (current.length > 1 ? 1 : 0);
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

/** Метаданные диалога без сообщений: это и есть содержимое head-строки. */
export function headOf(d: AIDialogue, segments: SegmentRef[] = []): DialogueHead {
  const head: DialogueHead = {
    head: true,
    id: d.id,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    schema: DIALOGUE_SCHEMA,
    title: d.title,
    personaId: d.personaId,
    personaName: d.personaName,
    personaEmoji: d.personaEmoji,
    segments,
  };
  if (d.documentId !== undefined) head.documentId = d.documentId;
  if (d.responseLength !== undefined) head.responseLength = d.responseLength;
  if (d.reasoning !== undefined) head.reasoning = d.reasoning;
  if (d.closingSummary !== undefined) head.closingSummary = d.closingSummary;
  if (d.archivedAt !== undefined) head.archivedAt = d.archivedAt;
  if (d.deletedAt !== undefined) head.deletedAt = d.deletedAt;
  if (d.deletedMessages !== undefined) head.deletedMessages = d.deletedMessages;
  if (d.lastExtractedMessageId !== undefined) head.lastExtractedMessageId = d.lastExtractedMessageId;
  return head;
}

/**
 * План записи диалога. `prev` — уже известный head: окно, которое в нём есть и
 * содержательно не изменилось, получает ТО ЖЕ имя, поэтому закрытый сегмент не
 * переписывается никогда — его строка остаётся на своём ключе. Границы окон
 * детерминированы временем первой реплики, так что дописывание в хвост не двигает
 * прежние окна. Идентичность окна оцениваем по размеру и числу реплик: совпадение по
 * обоим у разного содержимого практически невозможно, а ошибка стоит лишнюю запись,
 * но не потерю данных.
 */
export function planDialogue(
  d: AIDialogue,
  prev?: DialogueHead,
  limit = SEGMENT_MAX_BYTES,
): { head: DialogueHead; segments: DialogueSegment[]; toWrite: DialogueSegment[] } {
  const segments: DialogueSegment[] = [];
  const toWrite: DialogueSegment[] = [];
  for (const w of splitMessages(d.messages, limit)) {
    const firstAt = w[0]?.createdAt ?? d.createdAt;
    const size = bytes(JSON.stringify(w));
    const held = prev?.segments.find(s => s.firstAt === firstAt);
    // Два независимых вопроса: КАКОЕ ИМЯ у окна и НАДО ЛИ его переписывать.
    //  · открытое окно (последнее в прежнем head) разрешается и всегда остаётся под
    //    своим именем — иначе каждая дописка оставляла бы в облаке осиротевшую строку
    //    (тот самый мусор, из-за которого M-2 лечили nonce'ом);
    //  · закрытое окно меняет имя только если его переоткрыли (правка внутри него);
    //  · записываем при любом изменении содержимого, в том числе открытый хвост.
    const openWindow = prev?.segments.at(-1)?.firstAt === firstAt;
    const identical = held !== undefined && held.bytes === size && held.count === w.length;
    const keepName = held !== undefined && (openWindow === true || identical);
    const key = keepName ? held.key : segmentKeyOf(d.id, firstAt, newSegmentNonce());
    const seg: DialogueSegment = {
      seg: true,
      key,
      headKey: d.id,
      firstAt,
      lastAt: w.at(-1)?.createdAt ?? firstAt,
      updatedAt: identical ? held.updatedAt : d.updatedAt,
      messages: w,
    };
    segments.push(seg);
    if (!identical) toWrite.push(seg);
  }
  const refs: SegmentRef[] = segments.map(s => ({
    key: s.key, firstAt: s.firstAt, lastAt: s.lastAt, updatedAt: s.updatedAt,
    bytes: bytes(JSON.stringify(s.messages)), count: s.messages.length,
  }));
  return { head: headOf(d, refs), segments, toWrite };
}

/** Окно сегмента опознаётся по firstAt: переоткрытие (правка внутри закрытого
 *  сегмента) даёт тому же окну новое имя. В head на одно окно — одна ссылка. */
export function mergeHeads(a: DialogueHead, b: DialogueHead, now = Date.now()): DialogueHead {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const older = newer === a ? b : a;

  const byWindow = new Map<number, SegmentRef>();
  for (const ref of [...a.segments, ...b.segments]) {
    const held = byWindow.get(ref.firstAt);
    if (!held || ref.updatedAt > held.updatedAt || (ref.updatedAt === held.updatedAt && ref.key > held.key)) {
      byWindow.set(ref.firstAt, ref);
    }
  }

  const deletedMessages = mergeTombstones(a.deletedMessages, b.deletedMessages, now);
  const head: DialogueHead = {
    head: true,
    id: newer.id,
    createdAt: Math.min(a.createdAt, b.createdAt),
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    schema: DIALOGUE_SCHEMA,
    title: newer.title,
    personaId: newer.personaId,
    personaName: newer.personaName,
    personaEmoji: newer.personaEmoji,
    // Порядок окон — по времени первой реплики: он одинаков для любого порядка
    // прихода сегментов, поэтому два устройства собирают один и тот же диалог.
    segments: [...byWindow.values()].sort((x, y) => x.firstAt - y.firstAt || x.key.localeCompare(y.key)),
  };
  // S-58: удаление сильнее параллельной правки. Если хоть одна сторона знает о
  // надгробии, диалог мёртв; отметка — максимальная.
  const deletedAt = Math.max(a.deletedAt ?? 0, b.deletedAt ?? 0);
  if (deletedAt > 0) head.deletedAt = deletedAt;
  if (deletedMessages.length > 0) head.deletedMessages = deletedMessages;
  for (const k of ['documentId', 'responseLength', 'reasoning', 'closingSummary', 'archivedAt', 'lastExtractedMessageId'] as const) {
    const v = newer[k] ?? older[k];
    if (v !== undefined) (head as unknown as Record<string, unknown>)[k] = v;
  }
  return head;
}

function mergeTombstones(a: { id: string; at: number }[] | undefined, b: { id: string; at: number }[] | undefined, now: number) {
  const byId = new Map<string, number>();
  for (const list of [a ?? [], b ?? []]) for (const t of list) byId.set(t.id, Math.max(byId.get(t.id) ?? 0, t.at));
  return [...byId.entries()]
    .filter(([, at]) => now - at < TOMBSTONE_TTL_MS)
    .map(([id, at]) => ({ id, at }));
}

/** Собирает диалог из head и пришедших сегментов. Неизвестные сегменты (head ещё не
 *  догнал чужое окно) игнорируются: порядок задаёт head. */
export function assembleDialogue(head: DialogueHead, segments: Map<string, DialogueSegment>): AIDialogue {
  const messages: DialogueMessage[] = [];
  for (const ref of head.segments) {
    const seg = segments.get(ref.key);
    if (!seg) continue;
    messages.push(...seg.messages);
  }
  const d: AIDialogue = {
    id: head.id,
    title: head.title,
    personaId: head.personaId,
    personaName: head.personaName,
    personaEmoji: head.personaEmoji,
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
    messages,
    schema: DIALOGUE_SCHEMA,
  };
  if (head.documentId !== undefined) d.documentId = head.documentId;
  if (head.responseLength !== undefined) d.responseLength = head.responseLength;
  if (head.reasoning !== undefined) d.reasoning = head.reasoning;
  if (head.closingSummary !== undefined) d.closingSummary = head.closingSummary;
  if (head.archivedAt !== undefined) d.archivedAt = head.archivedAt;
  if (head.deletedAt !== undefined) d.deletedAt = head.deletedAt;
  if (head.deletedMessages !== undefined) d.deletedMessages = head.deletedMessages;
  if (head.lastExtractedMessageId !== undefined) d.lastExtractedMessageId = head.lastExtractedMessageId;
  return d;
}

/** Ключи сегментов, которые head больше не называет, — мусор после переоткрытия или
 *  проигравшей записи окна. Удаляет их устройство, выигравшее CAS head'а. */
export function staleSegmentKeys(head: DialogueHead, cloudKeys: string[]): string[] {
  const live = new Set(head.segments.map(s => s.key));
  const prefix = `${head.id}@seg`;
  return cloudKeys.filter(k => k.startsWith(prefix) && !live.has(k));
}

export interface CloudRowLike {
  key: string;
  payload: Record<string, unknown>;
}

export type SegmentCloudVersion =
  | { kind: 'segments'; head: DialogueHead; dialogue: AIDialogue; missing: string[] }
  | { kind: 'refused'; reason: string; missing: string[] };

function headFromPayload(p: Record<string, unknown>): DialogueHead | null {
  if (p.head !== true) return null;
  const id = p.id;
  const updatedAt = p.updatedAt;
  const segs = p.segments;
  if (typeof id !== 'string' || typeof updatedAt !== 'number' || !Array.isArray(segs)) return null;
  return p as unknown as DialogueHead;
}

/**
 * Сегментная версия диалога из его облачных строк (head `key` + строки `key@seg…`).
 *
 * Неполный набор — ОТКАЗ, а не «диалог без хвоста»: молча отдать обрезанный диалог
 * значит later выгрузить его поверх целого (тот же класс, что «empty = failed read»).
 * `missing` перечисляет окна, которых нет — по нему вызывающий решит, ждать ли ещё
 * один забор.
 */
export function readSegmentVersion(rows: CloudRowLike[]): SegmentCloudVersion | null {
  const headRow = rows.find(r => r.payload.head === true);
  if (!headRow) return null;
  const head = headFromPayload(headRow.payload);
  if (!head) return { kind: 'refused', reason: 'head-строка есть, но её форма не разобралась', missing: [] };

  const byKey = new Map<string, DialogueSegment>();
  for (const r of rows) {
    if (r.key === headRow.key || r.payload.seg !== true) continue;
    const raw = r.payload.messages;
    if (typeof raw !== 'string') return { kind: 'refused', reason: `сегмент ${r.key} без поля messages`, missing: [] };
    let messages: DialogueMessage[];
    try {
      messages = JSON.parse(raw) as DialogueMessage[];
    } catch {
      return { kind: 'refused', reason: `сегмент ${r.key}: messages не разбирается`, missing: [] };
    }
    if (!Array.isArray(messages)) return { kind: 'refused', reason: `сегмент ${r.key}: messages не массив`, missing: [] };
    byKey.set(r.key, {
      seg: true,
      key: r.key,
      headKey: head.id,
      firstAt: typeof r.payload.firstAt === 'number' ? r.payload.firstAt : 0,
      lastAt: typeof r.payload.lastAt === 'number' ? r.payload.lastAt : 0,
      updatedAt: typeof r.payload.updatedAt === 'number' ? r.payload.updatedAt : head.updatedAt,
      messages,
    });
  }

  const missing = head.segments.filter(s => !byKey.has(s.key)).map(s => s.key);
  if (missing.length > 0) {
    return { kind: 'refused', missing, reason: `не хватает ${missing.length} сегментов: ${missing.join(', ')}` };
  }

  const dialogue = assembleDialogue(head, new Map([...byKey.values()].map(s => [s.key, s])));
  return { kind: 'segments', head, dialogue, missing: [] };
}
