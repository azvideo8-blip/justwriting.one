import { parseNoteMarkdown } from '../../../core/services/noteFormat';
import { countWords } from '../../../shared/utils/countWords';
import { SyncService } from '../../../core/services/SyncService';
import { truncateText } from '../../../shared/utils/textLimits';
import { watchLocalDbStall } from '../../../core/storage/localDbStall';
import { reportMutationResult } from '../../../shared/mutationResult';

export interface ParsedImportFile {
  title: string;
  content: string;
  tags: string[];
  wordCount: number;
  date?: string | undefined;
  mood?: string | undefined;
}

// S-44.6 (S-19): title/mood уходят в облако шифротекстом base64(iv12 + ct + tag16);
// documents_title_check / documents_mood_check (0013) — ≤ 2000 символов. 500 символов
// CJK = 1500 байт → 2040 символов base64 → вечный 23514. Режем по байтам UTF-8:
// 1450 + 28 → 1972 символа. Не рвём кодовую точку (итерация по for..of).
const MAX_IMPORT_FIELD_BYTES = 1450;
function clampUtf8Bytes(s: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let bytes = 0;
  let out = '';
  for (const ch of s) {
    bytes += encoder.encode(ch).length;
    if (bytes > maxBytes) break;
    out += ch;
  }
  return out;
}

export function parseImportFile(fileName: string, rawContent: string): ParsedImportFile {
  const fallbackTitle = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
  const parsed = parseNoteMarkdown(rawContent, fallbackTitle);
  const wordCount = countWords(parsed.content);
  return {
    title: clampUtf8Bytes(truncateText(parsed.title || '', 500), MAX_IMPORT_FIELD_BYTES),
    content: parsed.content,
    tags: (parsed.tags ?? []).slice(0, 10).map(t => truncateText(String(t), 50)),
    wordCount,
    date: parsed.date,
    mood: parsed.mood != null ? clampUtf8Bytes(truncateText(parsed.mood, 500), MAX_IMPORT_FIELD_BYTES) : undefined,
  };
}

const MAX_DOCX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB limit (SEC-40)

// JSZip public ZipObject#internalStream (not in its index.d.ts).
interface ZipStream {
  on(evt: 'data', fn: (chunk: Uint8Array) => void): ZipStream;
  on(evt: 'end' | 'error', fn: (e: Error) => void): ZipStream;
  resume(): ZipStream;
  pause(): ZipStream;
}
interface ZipEntry {
  dir: boolean;
  internalStream(type: 'uint8array'): ZipStream;
}

// S-43: распаковывает запись потоково и считает реальные байты; при превышении cap
// ставит поток на паузу (дальше DataWorker чанки не отдаёт) и отклоняет промис.
function inflatedBytes(entry: ZipEntry, cap: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const stream = entry.internalStream('uint8array');
    stream
      .on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > cap) {
          stream.pause();
          reject(new Error('DOCX_TOO_LARGE: Total uncompressed archive size exceeds 50MB limit.'));
        }
      })
      .on('error', reject)
      .on('end', () => resolve(bytes))
      .resume();
  });
}

async function readFileContent(file: File): Promise<string | null> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'docx') {
    if (file.size > MAX_DOCX_SIZE_BYTES) {
      throw new Error('DOCX_TOO_LARGE: File size exceeds 10MB limit.');
    }
    const arrayBuffer = await file.arrayBuffer();

    // 1. Before mammoth: inflate every entry ourselves with a byte cap (50 MB for the whole archive).
    // S-43: uncompressedSize в заголовках zip — заявление автора файла; JSZip внутри mammoth
    // проверяет его только после полной распаковки в память. Поэтому считаем байты потоково.
    const MAX_UNCOMPRESSED_DOCX_BYTES = 50 * 1024 * 1024;
    const JSZipMod = await import('jszip');
    const JSZip = (JSZipMod.default ?? JSZipMod) as unknown as {
      loadAsync: (data: ArrayBuffer) => Promise<{ files: Record<string, ZipEntry> }>;
    };
    const zip = await JSZip.loadAsync(arrayBuffer);
    let totalUncompressed = 0;
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      totalUncompressed += await inflatedBytes(entry, MAX_UNCOMPRESSED_DOCX_BYTES - totalUncompressed);
    }

    const mammothMod = await import('mammoth');
    const mammoth = (mammothMod.default ?? mammothMod) as unknown as {
      convertToMarkdown: (input: { arrayBuffer: ArrayBuffer; buffer?: Buffer }) => Promise<{ value: string }>;
    };

    // 15-second timeout to prevent infinite zip/xml parsing hangs
    const mammothInput = {
      arrayBuffer,
      ...(typeof Buffer !== 'undefined' ? { buffer: Buffer.from(arrayBuffer) } : {}),
    };
    const parsePromise = mammoth.convertToMarkdown(mammothInput);
    const timeoutPromise = new Promise<{ value: string }>((_, reject) =>
      setTimeout(() => reject(new Error('DOCX_PARSE_TIMEOUT')), 15_000)
    );

    const result = await Promise.race([parsePromise, timeoutPromise]);

    // 2. After mammoth: result.value.length <= 10M characters (parity with txt/md).
    // Otherwise DOCX_TOO_LARGE before saveNew.
    const MAX_DECOMPRESSED_CHARS = 10_000_000;
    if (result.value.length > MAX_DECOMPRESSED_CHARS) {
      throw new Error('DOCX_TOO_LARGE: Result exceeds 10M characters limit.');
    }

    return result.value;
  }
  if (extension === 'txt' || extension === 'md') {
    if (file.size > MAX_DOCX_SIZE_BYTES) {
      throw new Error('FILE_TOO_LARGE: File size exceeds 10MB limit.');
    }
    return file.text();
  }
  return null;
}


export async function importNoteFile(
  file: File,
  userId: string,
  isSignedIn: boolean
): Promise<{ success: boolean; dateUnreadable?: boolean; queued?: boolean }> {
  const rawContent = await readFileContent(file);
  if (rawContent === null) return { success: false };

  const parsed = parseImportFile(file.name, rawContent);

  let dateUnreadable = false;
  let sessionStartedAt: Date;
  if (parsed.date) {
    const { parseLocalizedDate } = await import('../../../core/services/noteFormat');
    const parsedDate = parseLocalizedDate(parsed.date);
    if (parsedDate && !isNaN(parsedDate.getTime())) {
      sessionStartedAt = parsedDate;
    } else {
      dateUnreadable = true;
      sessionStartedAt = file.lastModified ? new Date(file.lastModified) : new Date();
    }
  } else {
    sessionStartedAt = file.lastModified ? new Date(file.lastModified) : new Date();
  }

  const { LocalStorageService } = await import('../../../core/services/LocalStorageService');
  // Дейлик 31.10: импорт пишет мимо StorageService — сторож DY10-9 ставим здесь.
  const { localId } = await watchLocalDbStall('importNote', LocalStorageService.saveNew(userId, {
    title: parsed.title,
    content: parsed.content,
    wordCount: parsed.wordCount,
    duration: 0,
    wpm: 0,
    sessionStartedAt,
    // D-4: дата из шапки файла (или lastModified) — это дата самой заметки.
    // Без неё saveNew поставил бы сегодняшний день, и весь импортированный
    // архив разложился бы по «сегодня» в списке, календаре и «в этот день».
    documentDate: sessionStartedAt,
    tags: parsed.tags,
    mood: parsed.mood,
  }));

  // NB-5: задача очереди не встала — обещание «в облаке» не подтверждено;
  // вызывающий показывает warning вместо успеха (образец — NB-4).
  let queued = true;
  if (isSignedIn) {
    try {
      await SyncService.addToQueue(localId, userId);
    } catch (queueErr) {
      queued = false;
      console.error('Import: failed to enqueue sync task', queueErr);
    }
    // Прямая выгрузка — и при отказе очереди: второй шанс, как до NB-5 (ревью 0.11.24, Nit 3).
    void SyncService.syncOne(userId, localId).catch((syncErr) => {
      console.warn('Import: cloud sync failed, task remains in syncQueue', syncErr);
    });
  }

  return { success: true, dateUnreadable, queued };
}

export interface ImportFeedbackDeps {
  userId: string;
  isSignedIn: boolean;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  onImported: () => void;
}

export async function importFilesWithFeedback(files: FileList | File[], deps: ImportFeedbackDeps): Promise<void> {
  const { userId, isSignedIn, showToast, t, onImported } = deps;
  let importedCount = 0;
  let failedCount = 0;
  let dateWarningCount = 0;
  let queueWarningCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    try {
      const res = await importNoteFile(file, userId, isSignedIn);
      if (res.success) {
        importedCount++;
        if (res.dateUnreadable) dateWarningCount++;
        if (res.queued === false) queueWarningCount++;
      } else {
        failedCount++;
      }
    } catch (err) {
      console.error('Failed to import file:', file.name, err);
      failedCount++;
    }
  }

  const cloudQueued = importedCount - queueWarningCount;
  if (cloudQueued > 0) {
    reportMutationResult({ showToast, t }, undefined, { successText: t('archive_import_success', { count: cloudQueued }) });
  }
  if (importedCount > 0) onImported();
  if (queueWarningCount > 0) {
    showToast(t('archive_import_local_only', { count: queueWarningCount }), 'warning');
  }
  if (dateWarningCount > 0) {
    showToast(t('archive_import_date_warning', { count: dateWarningCount }), 'error');
  }
  if (failedCount > 0) {
    showToast(t('archive_import_failed', { count: failedCount }), 'error');
  }
}



