import { randomUUID } from '../../../core/storage/localDb';
import type { AIDialogue, DialogueMessage } from '../../../core/storage/localDb';

// S-29: слияние двух реплик одного диалога вместо last-writer-wins.
// Прежнее правило («облако свежее — перезаписать») молча теряло ход того
// устройства, которое ответило вторым.

export function newMessageId(): string {
  return randomUUID();
}

// Идентичность реплики, написанной до S-29: (role, content, позиция). Оба
// устройства вычисляют одно и то же по одному и тому же префиксу, поэтому
// старый диалог сливается с самим собой без дублей.
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

// Варианты одного ответа: союз списков в порядке появления. Отметка, когда
// вариант создан, — сама позиция в списке того устройства, что его породил.
function unionVariants(a?: string[], b?: string[]): string[] | undefined {
  if (!a && !b) return undefined;
  const out: string[] = [];
  for (const v of [...(a ?? []), ...(b ?? [])]) {
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

function mergePair(primary: DialogueMessage, other: DialogueMessage): DialogueMessage {
  const variants = unionVariants(primary.variants, other.variants);
  return {
    ...primary,
    ...(variants ? { variants } : {}),
    ...(primary.reasoning === undefined && other.reasoning !== undefined ? { reasoning: other.reasoning } : {}),
  };
}

function lastExtractedIdOf(d: AIDialogue, merged: DialogueMessage[]): string | undefined {
  if (!d.lastExtractedMessageId) return undefined;
  return merged.some(m => m.id === d.lastExtractedMessageId) ? d.lastExtractedMessageId : undefined;
}

/**
 * союз реплик по id за минусом удалённых с обеих сторон; общий префикс хранит
 * порядок, хвост после расхождения сортируется по createdAt (разные часы
 * переставляют хвост, но не уносят ход), скаляры — LWW по updatedAt.
 */
export function mergeDialogues(local: AIDialogue, cloud: AIDialogue): AIDialogue {
  const a = withMessageIds(local);
  const b = withMessageIds(cloud);
  const aNewer = (a.updatedAt ?? 0) >= (b.updatedAt ?? 0);
  const newer = aNewer ? a : b;
  const older = aNewer ? b : a;

  const deleted = new Set<string>([...(a.deletedMessageIds ?? []), ...(b.deletedMessageIds ?? [])]);

  let common = 0;
  while (common < a.messages.length && common < b.messages.length && a.messages[common]?.id === b.messages[common]?.id) common++;

  const seen = new Set<string>();
  const prefix: DialogueMessage[] = [];
  for (let i = 0; i < common; i++) {
    const mine = aNewer ? a.messages[i]! : b.messages[i]!;
    const theirs = aNewer ? b.messages[i]! : a.messages[i]!;
    if (!mine.id || deleted.has(mine.id) || seen.has(mine.id)) continue;
    seen.add(mine.id);
    prefix.push(mergePair(mine, theirs));
  }

  const tailSource = [...a.messages.slice(common), ...b.messages.slice(common)];
  const tailById = new Map<string, DialogueMessage>();
  for (const m of tailSource) {
    if (!m.id || deleted.has(m.id) || seen.has(m.id)) continue;
    const known = tailById.get(m.id);
    tailById.set(m.id, known ? mergePair(known, m) : m);
  }
  const tail = [...tailById.values()].sort((x, y) =>
    (x.createdAt ?? 0) - (y.createdAt ?? 0) || (x.id! < y.id! ? -1 : x.id! > y.id! ? 1 : 0));

  const messages = [...prefix, ...tail];
  const extracted = lastExtractedIdOf(newer, messages) ?? lastExtractedIdOf(older, messages);

  return {
    ...newer,
    messages,
    createdAt: Math.min(a.createdAt ?? 0, b.createdAt ?? 0),
    updatedAt: Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0),
    deletedMessageIds: [...deleted],
    ...(extracted ? { lastExtractedMessageId: extracted } : {}),
  };
}

/** Нужно писателям: id и момент создания ставятся при создании реплики. */
export function stampMessage(m: DialogueMessage, now = Date.now()): DialogueMessage {
  return { ...m, id: m.id ?? newMessageId(), createdAt: m.createdAt ?? now };
}

