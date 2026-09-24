import { parseNoteMarkdown } from '../../../core/services/noteFormat';
import { countWords } from '../../../shared/utils/countWords';

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
    const mammothMod = await import('mammoth');
    const mammoth = (mammothMod.default ?? mammothMod) as unknown as {
      convertToMarkdown: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
    };

    // 15-second timeout to prevent infinite zip/xml parsing hangs
    const parsePromise = mammoth.convertToMarkdown({ arrayBuffer });
    const timeoutPromise = new Promise<{ value: string }>((_, reject) =>
      setTimeout(() => reject(new Error('DOCX_PARSE_TIMEOUT')), 15_000)
    );

    const result = await Promise.race([parsePromise, timeoutPromise]);
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
    const { SyncService } = await import('../../../core/services/SyncService');
    try {
      await SyncService.addToQueue(localId);
    } catch (queueErr) {
      console.error('Import: failed to enqueue sync task', queueErr);
    }
    void SyncService.syncOne(userId, localId).catch((syncErr) => {
      console.warn('Import: cloud sync failed, task remains in syncQueue', syncErr);
    });
  }

  return { success: true, dateUnreadable };
}

const MAX_BATCH_COUNT = 20;

export async function importBatchFiles(
  files: File[],
  userId: string,
  isSignedIn: boolean
): Promise<{ successCount: number; failureCount: number; unreadableDateCount: number }> {
  if (files.length > MAX_BATCH_COUNT) {
    throw new Error(`BATCH_LIMIT_EXCEEDED: Maximum ${MAX_BATCH_COUNT} files allowed per import.`);
  }

  let successCount = 0;
  let failureCount = 0;
  let unreadableDateCount = 0;

  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['txt', 'md', 'docx'].includes(ext)) {
      failureCount += 1;
      continue;
    }

    try {
      const res = await importNoteFile(file, userId, isSignedIn);
      if (res.success) {
        successCount += 1;
        if (res.dateUnreadable) unreadableDateCount += 1;
      } else {
        failureCount += 1;
      }
    } catch {
      failureCount += 1;
    }
  }

  return { successCount, failureCount, unreadableDateCount };
}


