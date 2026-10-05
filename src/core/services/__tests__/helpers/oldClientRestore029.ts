// Порт read-пути клиента 0.9.29 (он же в 0.9.28) — общий для тестов M-3 и M-5.
// main:src/features/ai/services/AIRestoreService.ts, байт-в-байт совпадает с кодом в
// 8eeb52cf и d9e6378f: строки 194–221 (разбор ключа и группировка), 226–235 (unpaged),
// 236–282 (сборка версии), 293–300 (чтение страниц), 358–389 (сравнение отметок, db.put).
// Перенесён из dialogueOldClientShapes.m3.test.ts без изменений, чтобы проверка форм
// M-5 смотрела тем же кодом, что и защита M-3.
import type { AIDialogue } from '../../../storage/localDb';

export type Row = { store: string; key: string; payload: Record<string, unknown> };

export interface OldWrite {
  baseKey: string;
  dialogue: AIDialogue;
}

/** Что старый клиент записал бы в IndexedDB, увидев эти облачные строки. */
export function oldClientWrites(rows: Row[], localById: Map<string, AIDialogue>): OldWrite[] {
  const writes: OldWrite[] = [];
  const grouped = new Map<string, { store: string; baseKey: string; items: Array<{ pageIndex: number | null; payload: Record<string, unknown> }> }>();

  for (const rec of rows) {
    if (rec.store !== 'aiDialogues') continue;
    const hashIdx = rec.key.lastIndexOf('#');
    let baseKey = rec.key;
    let pageIndex: number | null = null;
    if (hashIdx !== -1) {
      const suffix = rec.key.slice(hashIdx + 1);
      if (/^\d+$/.test(suffix)) {
        baseKey = rec.key.slice(0, hashIdx);
        pageIndex = parseInt(suffix, 10);
      }
    }
    const groupKey = `${rec.store}:${baseKey}`;
    let grp = grouped.get(groupKey);
    if (!grp) {
      grp = { store: rec.store, baseKey, items: [] };
      grouped.set(groupKey, grp);
    }
    grp.items.push({ pageIndex, payload: rec.payload });
  }

  for (const { baseKey, items } of grouped.values()) {
    let fullJson: string;
    let cloudTs: number | null = null;
    const isPaged = items.some(it => it.pageIndex !== null);

    if (!isPaged) {
      const item = items[0];
      if (!item) continue;
      if (typeof item.payload.data !== 'string') continue;
      fullJson = item.payload.data;
      cloudTs = typeof item.payload.updatedAt === 'number' ? item.payload.updatedAt : null;
    } else {
      const withTs = items.filter(it => it.pageIndex !== null && typeof it.payload.updatedAt === 'number' && typeof it.payload.totalPages === 'number');
      if (withTs.length === 0) continue;
      const byVersion = new Map<string, typeof withTs>();
      for (const it of withTs) {
        const k = `${it.payload.updatedAt}|${it.payload.totalPages}`;
        byVersion.set(k, [...(byVersion.get(k) ?? []), it]);
      }
      const newest = [...byVersion.values()].sort((a, b) => (b[0]!.payload.updatedAt as number) - (a[0]!.payload.updatedAt as number))[0]!;
      const expectedTotalPages = newest[0]!.payload.totalPages as number;
      const expectedUpdatedAt = newest[0]!.payload.updatedAt as number;
      const pagesByIndex = new Map<number, (typeof withTs)[number]>();
      let integrity = true;
      for (const it of newest) {
        if (it.pageIndex === null) continue;
        if (pagesByIndex.has(it.pageIndex)) { integrity = false; break; }
        pagesByIndex.set(it.pageIndex, it);
      }
      if (!integrity) continue;
      const sorted: typeof withTs = [];
      for (let i = 0; i < expectedTotalPages; i++) {
        const p = pagesByIndex.get(i);
        if (!p) { integrity = false; break; }
        sorted.push(p);
      }
      if (!integrity) continue;
      if (pagesByIndex.size !== expectedTotalPages) continue;
      const chunks: string[] = [];
      let decryptFailed = false;
      for (const p of sorted) {
        // maybeDecrypt в моках стенда — identity; поле читателя — всегда `data`.
        if (typeof p.payload.data !== 'string') { decryptFailed = true; break; }
        chunks.push(p.payload.data);
      }
      if (decryptFailed) continue;
      fullJson = chunks.join('');
      cloudTs = expectedUpdatedAt;
    }

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(fullJson);
    } catch {
      continue;
    }
    if (typeof parsedData !== 'object' || parsedData === null) continue;

    const dialogue = parsedData as AIDialogue;
    if (typeof dialogue.updatedAt === 'number') cloudTs = dialogue.updatedAt;

    const localRecord = localById.get(baseKey);
    const put = () => writes.push({ baseKey, dialogue });
    if (localRecord !== undefined) {
      const localTs = typeof localRecord.updatedAt === 'number' ? localRecord.updatedAt : null;
      if (localTs !== null && cloudTs !== null && cloudTs > localTs) put();
    } else {
      put();
    }
  }
  return writes;
}
