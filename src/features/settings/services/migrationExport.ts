import { getLocalDb, type LocalDocument, type LocalVersion, type LocalDraft, type AIDocumentSummary, type AIDocumentEmbedding } from '../../../core/storage/localDb';

const MANIFEST_VERSION = 1;
const CURSOR_KEY = 'migration_export_cursor';

export interface MigrationManifest {
  version: number;
  exportedAt: string;
  documents: MigrationDocument[];
  drafts: MigrationDraft[];
  aiSummaries: AIDocumentSummary[];
  aiEmbeddings: AIDocumentEmbedding[];
  counters: {
    documents: number;
    versions: number;
    drafts: number;
    aiSummaries: number;
    aiEmbeddings: number;
  };
  checksums: Record<string, string>;  // version id → sha-256 hex
  skipped: { store: string; id: string; reason: string }[];
}

export interface MigrationDocument {
  uuid: string;
  localId: string;
  linkedCloudId?: string | undefined;
  title: string;
  currentVersion: number;
  totalWords: number;
  totalDuration: number;
  sessionsCount: number;
  firstSessionAt: number;
  lastSessionAt: number;
  tags: string[];
  labelId?: string | undefined;
  mood?: string | undefined;
  versions: MigrationVersion[];
}

export interface MigrationVersion {
  id: string;
  version: number;
  content: string;
  wordCount: number;
  wordsAdded: number;
  charsAdded: number;
  duration: number;
  wpm: number;
  goalWords?: number | undefined;
  goalTime?: number | undefined;
  goalReached?: boolean | undefined;
  savedAt: number;
  sessionStartedAt: number;
  mood?: string | undefined;
}

export interface MigrationDraft {
  userId: string;
  title?: string;
  content: string;
  updatedAt: number;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getCursor(): { store: string; lastId: string } | null {
  try {
    const raw = localStorage.getItem(CURSOR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCursor(store: string, lastId: string): void {
  try {
    localStorage.setItem(CURSOR_KEY, JSON.stringify({ store, lastId }));
  } catch { /* best-effort */ }
}

function clearCursor(): void {
  try { localStorage.removeItem(CURSOR_KEY); } catch { /* ignore */ }
}

/** Export all local data for migration.  Resumable: a cursor in localStorage
 *  records the last completed store so a interrupted export continues rather
 *  than restarting. */
export async function exportMigrationManifest(): Promise<MigrationManifest> {
  const db = await getLocalDb();
  const skipped: MigrationManifest['skipped'] = [];
  const checksums: Record<string, string> = {};

  const cursor = getCursor();
  const doneStores = new Set<string>();
  if (cursor) {
    // Mark everything before the cursor's store as done.
    const order = ['documents', 'drafts', 'aiSummaries', 'aiEmbeddings'] as const;
    for (const s of order) {
      if (s === cursor.store) break;
      doneStores.add(s);
    }
  }

  // ── documents + versions ──────────────────────────────────────────────
  let documents: MigrationDocument[] = [];
  if (!doneStores.has('documents')) {
    try {
      const allDocs = await db.getAll('documents');
      const docsToExport = cursor?.store === 'documents'
        ? allDocs.filter(d => (d as LocalDocument).id > cursor.lastId)
        : allDocs;

      for (const doc of docsToExport) {
        try {
          const d = doc as LocalDocument;
          if (!d.uuid) {
            skipped.push({ store: 'documents', id: d.id, reason: 'missing uuid (pre-C1 doc)' });
            continue;
          }
          const versions = await db.getAllFromIndex('versions', 'by-document', d.id);
          const migVersions: MigrationVersion[] = [];
          for (const v of versions) {
            try {
              const ver = v as LocalVersion;
              const checksum = await sha256Hex(ver.content);
              checksums[ver.id] = checksum;
              migVersions.push({
                id: ver.id,
                version: ver.version,
                content: ver.content,
                wordCount: ver.wordCount,
                wordsAdded: ver.wordsAdded,
                charsAdded: ver.charsAdded,
                duration: ver.duration,
                wpm: ver.wpm,
                goalWords: ver.goalWords,
                goalTime: ver.goalTime,
                goalReached: ver.goalReached,
                savedAt: ver.savedAt,
                sessionStartedAt: ver.sessionStartedAt,
                mood: ver.mood,
              });
            } catch (e) {
              skipped.push({ store: 'versions', id: v.id, reason: String(e) });
            }
          }
          documents.push({
            uuid: d.uuid,
            localId: d.id,
            linkedCloudId: d.linkedCloudId,
            title: d.title,
            currentVersion: d.currentVersion,
            totalWords: d.totalWords,
            totalDuration: d.totalDuration,
            sessionsCount: d.sessionsCount,
            firstSessionAt: d.firstSessionAt,
            lastSessionAt: d.lastSessionAt,
            tags: d.tags,
            labelId: d.labelId,
            mood: d.mood,
            versions: migVersions,
          });
        } catch (e) {
          skipped.push({ store: 'documents', id: (doc as LocalDocument).id, reason: String(e) });
        }
      }
      setCursor('documents', (docsToExport.at(-1) as LocalDocument)?.id ?? '');
    } catch (e) {
      skipped.push({ store: 'documents', id: '*', reason: String(e) });
    }
  }

  // ── drafts ────────────────────────────────────────────────────────────
  let drafts: MigrationDraft[] = [];
  if (!doneStores.has('drafts')) {
    try {
      const allDrafts = await db.getAll('drafts');
      for (const raw of allDrafts) {
        try {
          const d = raw as LocalDraft;
          drafts.push({
            userId: d.userId,
            title: d.title,
            content: d.content,
            updatedAt: d.updatedAt,
          });
        } catch (e) {
          skipped.push({ store: 'drafts', id: (raw as LocalDraft).userId, reason: String(e) });
        }
      }
      setCursor('drafts', (allDrafts.at(-1) as LocalDraft)?.userId ?? '');
    } catch (e) {
      skipped.push({ store: 'drafts', id: '*', reason: String(e) });
    }
  }

  // ── ai_summaries ──────────────────────────────────────────────────────
  let aiSummaries: AIDocumentSummary[] = [];
  if (!doneStores.has('aiSummaries')) {
    try {
      const all = await db.getAll('aiSummaries');
      aiSummaries = all as AIDocumentSummary[];
      setCursor('aiSummaries', (all.at(-1) as AIDocumentSummary)?.documentId ?? '');
    } catch (e) {
      skipped.push({ store: 'aiSummaries', id: '*', reason: String(e) });
    }
  }

  // ── ai_embeddings ─────────────────────────────────────────────────────
  let aiEmbeddings: AIDocumentEmbedding[] = [];
  if (!doneStores.has('aiEmbeddings')) {
    try {
      const all = await db.getAll('aiEmbeddings');
      aiEmbeddings = all as AIDocumentEmbedding[];
      setCursor('aiEmbeddings', (all.at(-1) as AIDocumentEmbedding)?.documentId ?? '');
    } catch (e) {
      skipped.push({ store: 'aiEmbeddings', id: '*', reason: String(e) });
    }
  }

  clearCursor();

  // ── version counts (from the exported versions, not document metadata) ─
  const versionCount = documents.reduce((sum, d) => sum + d.versions.length, 0);

  return {
    version: MANIFEST_VERSION,
    exportedAt: new Date().toISOString(),
    documents,
    drafts,
    aiSummaries,
    aiEmbeddings,
    counters: {
      documents: documents.length,
      versions: versionCount,
      drafts: drafts.length,
      aiSummaries: aiSummaries.length,
      aiEmbeddings: aiEmbeddings.length,
    },
    checksums,
    skipped,
  };
}
