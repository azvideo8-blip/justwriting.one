import { getLocalDb, type LocalDocument, type LocalVersion, type LocalDraft, type AIDocumentSummary, type AIDocumentEmbedding } from '../../../core/storage/localDb';

const MANIFEST_VERSION = 1;
const CURSOR_KEY = 'migration_export_cursor';

/** Хранилища, которые переносятся дословно. Их содержимое нигде на сервере не
 *  разбирается по полям — от них требуется пережить круг «выгрузили → залили»
 *  без потерь, а не лечь в типизированную схему. Заводить под каждое свой
 *  интерфейс значит писать двадцать блоков ради данных, которые никто не
 *  читает по частям. */
const VERBATIM_STORES: { store: string; keyPath: string }[] = [
  { store: 'aiDialogues', keyPath: 'id' },
  { store: 'aiDialogueEvents', keyPath: 'dialogueId' },
  { store: 'aiChatMemory', keyPath: 'id' },
  { store: 'aiCommitments', keyPath: 'id' },
  { store: 'aiThreads', keyPath: 'id' },
  { store: 'aiTimeline', keyPath: 'documentId' },
  { store: 'aiBeliefs', keyPath: 'id' },
  { store: 'aiBeliefRejections', keyPath: 'id' },
  { store: 'aiPeopleIndex', keyPath: 'key' },
  { store: 'aiPortrait', keyPath: 'id' },
  { store: 'aiProfileFacets', keyPath: 'id' },
  { store: 'aiThemeLedger', keyPath: 'id' },
  { store: 'aiMonthlyDigest', keyPath: 'month' },
  { store: 'aiDomainVectors', keyPath: 'cacheKey' },
  { store: 'aiPersonas', keyPath: 'id' },
  { store: 'aiInjectionJournal', keyPath: 'id' },
  { store: 'lifeStory', keyPath: 'eventDate' },
  { store: 'profile', keyPath: 'guestId' },
];

// syncQueue и pending_sessions НЕ входят в VERBATIM_STORES: это очередь
// незавершённой работы этого устройства, а не данные пользователя. Переносить
// её на новый бэкенд нельзя — задачи ссылаются на идентификаторы Firestore,
// которых там не будет.

export interface VerbatimRecord {
  store: string;
  key: string;
  /** Запись как есть. Шифротекст не расшифровывается, поля не переименовываются. */
  payload: unknown;
}

export interface MigrationManifest {
  version: number;
  exportedAt: string;
  documents: MigrationDocument[];
  drafts: MigrationDraft[];
  aiSummaries: AIDocumentSummary[];
  aiEmbeddings: AIDocumentEmbedding[];
  verbatim: VerbatimRecord[];
  counters: {
    documents: number;
    versions: number;
    drafts: number;
    aiSummaries: number;
    aiEmbeddings: number;
    verbatim: Record<string, number>;
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
    const order = [
      'documents', 'drafts', 'aiSummaries', 'aiEmbeddings',
      ...VERBATIM_STORES.map(v => v.store),
    ] as const;
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

  // ── хранилища, переносимые дословно ───────────────────────────────────
  const verbatim: VerbatimRecord[] = [];
  const verbatimCounters: Record<string, number> = {};
  for (const { store, keyPath } of VERBATIM_STORES) {
    if (doneStores.has(store)) continue;
    if (!db.objectStoreNames.contains(store)) continue;   // схема младше этого клиента
    try {
      const all = await db.getAll(store as never);
      for (const raw of all) {
        try {
          const key = String((raw as Record<string, unknown>)[keyPath] ?? '');
          verbatim.push({ store, key, payload: raw });
          checksums[`${store}:${key}`] = await sha256Hex(JSON.stringify(raw));
        } catch (e) {
          // Не смогли прочитать запись — это НЕ «записи нет». Молчаливое
          // превращение сбоя чтения в отсутствие данных — худший класс ошибок
          // в этом проекте, и здесь он стоил бы всей памяти ИИ.
          skipped.push({ store, id: '?', reason: String(e) });
        }
      }
      verbatimCounters[store] = all.length;
      setCursor(store, String((all.at(-1) as Record<string, unknown>)?.[keyPath] ?? ''));
    } catch (e) {
      skipped.push({ store, id: '*', reason: String(e) });
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
    verbatim,
    counters: {
      documents: documents.length,
      versions: versionCount,
      drafts: drafts.length,
      aiSummaries: aiSummaries.length,
      aiEmbeddings: aiEmbeddings.length,
      verbatim: verbatimCounters,
    },
    checksums,
    skipped,
  };
}
