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

async function readFileContent(file: File): Promise<string | null> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'docx') {
    const arrayBuffer = await file.arrayBuffer();
    const mammothMod = await import('mammoth');
    const mammoth = (mammothMod.default ?? mammothMod) as unknown as {
      convertToMarkdown: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
    };
    const result = await mammoth.convertToMarkdown({ arrayBuffer });
    return result.value;
  }
  if (extension === 'txt' || extension === 'md') {
    return file.text();
  }
  return null;
}

/**
 * Imports a note file into local storage and, for signed-in users, best-effort
 * syncs it to the cloud (falling back to the sync queue on failure) — the same
 * guarantee normal writing-session saves get from cleanupDraftsAfterSave.
 * Imports bypass that path entirely, so without this they'd be local-only forever.
 */
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
