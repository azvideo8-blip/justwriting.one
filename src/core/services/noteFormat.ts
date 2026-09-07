/**
 * E-5: Unified note serialization and parsing format.
 *
 * All exports (ArchiveExportService, ExportAllService) serialize notes
 * using standard YAML front matter (Obsidian, Logseq, Jekyll compatible).
 *
 * Import (archiveImport) accepts both YAML front matter and legacy
 * header-based formats (# Title \n\n **Дата:** ...) from older versions.
 */

export interface NoteMarkdownData {
  title?: string | undefined;
  date?: string | Date | number | undefined;
  tags?: string[] | undefined;
  mood?: string | undefined;
  content?: string | undefined;
}

export interface ParsedNoteMarkdown {
  title: string;
  content: string;
  tags: string[];
  date?: string | undefined;
  mood?: string | undefined;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function serializeNoteMarkdown(data: NoteMarkdownData): string {
  const lines: string[] = ['---'];

  if (data.title !== undefined && data.title !== null) {
    lines.push(`title: ${JSON.stringify(data.title)}`);
  }

  if (data.date !== undefined && data.date !== null) {
    let dateStr: string;
    if (data.date instanceof Date) {
      dateStr = data.date.toISOString();
    } else if (typeof data.date === 'number') {
      dateStr = new Date(data.date).toISOString();
    } else {
      dateStr = String(data.date);
    }
    lines.push(`date: ${JSON.stringify(dateStr)}`);
  }

  if (data.tags && data.tags.length > 0) {
    const formattedTags = `[${data.tags.map(t => JSON.stringify(t)).join(', ')}]`;
    lines.push(`tags: ${formattedTags}`);
  }

  if (data.mood) {
    lines.push(`mood: ${JSON.stringify(data.mood)}`);
  }

  lines.push('---');
  lines.push('');
  lines.push(data.content ?? '');

  return lines.join('\n');
}

function unquote(val: string): string {
  const trimmed = val.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function parseNoteMarkdown(rawText: string, fallbackTitle?: string): ParsedNoteMarkdown {
  if (!rawText) {
    return {
      title: fallbackTitle || '',
      content: '',
      tags: [],
    };
  }

  const frontMatterMatch = rawText.match(FRONTMATTER_REGEX);
  if (frontMatterMatch) {
    const yaml = frontMatterMatch[1] ?? '';
    const content = (frontMatterMatch[2] ?? '').replace(/^\r?\n/, '');

    let title: string | undefined;
    let date: string | undefined;
    let mood: string | undefined;
    const tags: string[] = [];

    const lines = yaml.split(/\r?\n/);
    let inListKey: string | null = null;

    for (const line of lines) {
      const listMatch = line.match(/^\s*-\s+(.*)$/);
      if (listMatch && inListKey === 'tags') {
        const val = unquote(listMatch[1] ?? '');
        if (val) tags.push(val);
        continue;
      }

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const val = line.slice(colonIdx + 1).trim();

      if (key === 'tags') {
        inListKey = 'tags';
        if (val) {
          const cleanVal = val.replace(/^\[/, '').replace(/\]$/, '').trim();
          if (cleanVal) {
            for (const item of cleanVal.split(',')) {
              const unquoted = unquote(item);
              if (unquoted) tags.push(unquoted);
            }
          }
        }
      } else {
        inListKey = null;
        if (key === 'title') {
          title = unquote(val);
        } else if (key === 'date') {
          date = unquote(val);
        } else if (key === 'mood') {
          mood = unquote(val);
        }
      }
    }

    return {
      title: title || fallbackTitle || '',
      content,
      tags,
      date,
      mood,
    };
  }

  // Check for legacy header format (0.8.x and prior exports):
  // # Note Title
  //
  // **Дата:** ...
  // **Теги:** #tag1 #tag2
  // ---
  // Body text
  const legacyMatch = rawText.match(/^\s*#\s+([^\r\n]+)\r?\n([\s\S]*)$/);
  if (legacyMatch) {
    const headerTitle = (legacyMatch[1] ?? '').trim();
    const rest = legacyMatch[2] ?? '';
    const lines = rest.split(/\r?\n/);

    let parsedDate: string | undefined;
    let parsedMood: string | undefined;
    const parsedTags: string[] = [];
    let bodyStartIndex = 0;
    let inHeaderSection = true;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();

      if (!inHeaderSection) break;

      if (trimmed === '') {
        continue;
      }

      if (/^---+$/.test(trimmed)) {
        bodyStartIndex = i + 1;
        inHeaderSection = false;
        break;
      }

      const dateMatch = trimmed.match(/^\*\*(?:Дата|Date):\*\*\s*([^|\n]+)/i);
      if (dateMatch) {
        parsedDate = (dateMatch[1] ?? '').trim();
        continue;
      }

      const tagsMatch = trimmed.match(/^\*\*(?:Теги|Tags):\*\*\s*(.*)$/i);
      if (tagsMatch) {
        const rawTags = (tagsMatch[1] ?? '').trim();
        const items = rawTags.split(/[\s,]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
        parsedTags.push(...items);
        continue;
      }

      const moodMatch = trimmed.match(/^\*\*(?:Настроение|Mood):\*\*\s*(.*)$/i);
      if (moodMatch) {
        parsedMood = (moodMatch[1] ?? '').trim();
        continue;
      }

      if (/^\*\*(?:Слов|Words|Время|Time):\*\*/i.test(trimmed)) {
        continue;
      }

      // Reached actual note content without an explicit --- fence
      bodyStartIndex = i;
      inHeaderSection = false;
      break;
    }

    const body = lines.slice(bodyStartIndex).join('\n').replace(/^\n+/, '');
    return {
      title: headerTitle || fallbackTitle || '',
      content: body,
      tags: parsedTags,
      date: parsedDate,
      mood: parsedMood,
    };
  }

  return {
    title: fallbackTitle || '',
    content: rawText,
    tags: [],
  };
}

export { parseLocalizedDate } from '../utils/dateUtils';

