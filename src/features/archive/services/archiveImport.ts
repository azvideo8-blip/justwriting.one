import { parseNoteMarkdown } from '../../../core/services/noteFormat';
import { countWords } from '../../../shared/utils/countWords';
import { SyncService } from '../../../core/services/SyncService';

export interface ParsedImportFile {
  title: string;
  content: string;
  tags: string[];
  wordCount: number;
  date?: string | undefined;
  mood?: string | undefined;
}

export function parseImportFile(fileName: string, rawContent: string): ParsedImportFile {
  const fallbackTitle = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
  const parsed = parseNoteMarkdown(rawContent, fallbackTitle);
  const wordCount = countWords(parsed.content);
  return {
    title: parsed.title,
    content: parsed.content,
    tags: parsed.tags,
    wordCount,
    date: parsed.date,
    mood: parsed.mood,
  };
}

const MAX_DOCX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB limit (SEC-40)

async function readFileContent(file: File): Promise<string | null> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'docx') {
    if (file.size > MAX_DOCX_SIZE_BYTES) {
      throw new Error('DOCX_TOO_LARGE: File size exceeds 10MB limit.');
    }
    const arrayBuffer = await file.arrayBuffer();

    // 1. Before mammoth: JSZip.loadAsync reads the central directory.
    // Reject when word/document.xml or the archive's total uncompressed size is over a budget (50 MB).
    const MAX_UNCOMPRESSED_DOCX_BYTES = 50 * 1024 * 1024;
    const JSZipMod = await import('jszip');
    const JSZip = (JSZipMod.default ?? JSZipMod) as unknown as {
      loadAsync: (data: ArrayBuffer) => Promise<{ files: Record<string, { _data?: { uncompressedSize?: number } }> }>;
    };
    const zip = await JSZip.loadAsync(arrayBuffer);
    let totalUncompressed = 0;
    for (const [name, entry] of Object.entries(zip.files)) {
      const size = entry._data?.uncompressedSize ?? 0;
      if (name === 'word/document.xml' && size > MAX_UNCOMPRESSED_DOCX_BYTES) {
        throw new Error('DOCX_TOO_LARGE: Uncompressed document.xml exceeds 50MB limit.');
      }
      totalUncompressed += size;
      if (totalUncompressed > MAX_UNCOMPRESSED_DOCX_BYTES) {
        throw new Error('DOCX_TOO_LARGE: Total uncompressed archive size exceeds 50MB limit.');
      }
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
): Promise<{ success: boolean; dateUnreadable?: boolean }> {
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
  const { localId } = await LocalStorageService.saveNew(userId, {
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
  });

  if (isSignedIn) {
    try {
      await SyncService.addToQueue(localId, userId);
    } catch (queueErr) {
      console.error('Import: failed to enqueue sync task', queueErr);
    }
    void SyncService.syncOne(userId, localId).catch((syncErr) => {
      console.warn('Import: cloud sync failed, task remains in syncQueue', syncErr);
    });
  }

  return { success: true, dateUnreadable };
}



