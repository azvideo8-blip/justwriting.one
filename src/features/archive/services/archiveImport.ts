export interface ParsedImportFile {
  title: string;
  content: string;
  tags: string[];
  wordCount: number;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

export function parseImportFile(fileName: string, rawContent: string): ParsedImportFile {
  let title = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
  let tags: string[] = [];
  let content = rawContent;

  const match = rawContent.match(FRONTMATTER_REGEX);
  if (match) {
    const yaml = match[1] ?? '';
    content = rawContent.replace(FRONTMATTER_REGEX, '');
    for (const line of yaml.split(/\r?\n/)) {
      const parts = line.split(':');
      if (parts.length < 2) continue;
      const key = parts[0]?.trim().toLowerCase();
      if (!key) continue;
      const value = parts.slice(1).join(':').trim();
      if (key === 'title') {
        title = value.replace(/^["']|["']$/g, '');
      } else if (key === 'tags') {
        const cleanValue = value.replace('[', '').replace(']', '');
        tags = cleanValue.split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      }
    }
  }

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  return { title, content, tags, wordCount };
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
): Promise<{ success: boolean }> {
  const rawContent = await readFileContent(file);
  if (rawContent === null) return { success: false };

  const parsed = parseImportFile(file.name, rawContent);

  const { LocalStorageService } = await import('../../../core/services/LocalStorageService');
  const { localId } = await LocalStorageService.saveNew(userId, {
    title: parsed.title,
    content: parsed.content,
    wordCount: parsed.wordCount,
    duration: 0,
    wpm: 0,
    sessionStartedAt: new Date(),
    tags: parsed.tags,
  });

  if (isSignedIn) {
    const { SyncService } = await import('../../../core/services/SyncService');
    SyncService.syncOne(userId, localId).catch((syncErr) => {
      console.warn('Import: cloud sync failed, queuing for retry', syncErr);
      void SyncService.addToQueue(localId);
    });
  }

  return { success: true };
}

const MAX_BATCH_COUNT = 20;

export async function importBatchFiles(
  files: File[],
  userId: string,
  isSignedIn: boolean
): Promise<{ successCount: number; failureCount: number }> {
  if (files.length > MAX_BATCH_COUNT) {
    throw new Error(`BATCH_LIMIT_EXCEEDED: Maximum ${MAX_BATCH_COUNT} files allowed per import.`);
  }

  let successCount = 0;
  let failureCount = 0;

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
      } else {
        failureCount += 1;
      }
    } catch {
      failureCount += 1;
    }
  }

  return { successCount, failureCount };
}


