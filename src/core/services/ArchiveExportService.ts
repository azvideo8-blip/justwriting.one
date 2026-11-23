import { ArchiveSession, ExportStrings } from '../../shared/types/common';
import { toDate } from '../utils/dateUtils';
import { escapeHtml } from '../../shared/utils/exportUtils';
import { reportError } from '../../shared/errors/reportError';
import { serializeNoteMarkdown } from './noteFormat';
import { isBlankTitle } from '../../shared/utils/titleUtils';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

export type { ExportStrings };

/**
 * Отказ Web Share — это НЕ сбой экспорта.
 *
 * `navigator.canShare({files})` на десктопе отвечает утвердительно, а
 * `navigator.share()` потом бросает `NotAllowedError` («Permission denied»);
 * человек, закрывший системную шторку, даёт `AbortError`. В обоих случаях ниже
 * отрабатывает обычная загрузка файла, и файл сохраняется — то есть операция
 * УДАЛАСЬ. Запись «ERROR archive_export_share: Permission denied» на каждом
 * сохранении — ложная тревога, а журнал, где привычно лежит неправдивая
 * ошибка, перестают читать: настоящая теряется среди неё.
 *
 * Всё, что сюда не попало, остаётся ошибкой и репортится как раньше.
 */
export function isExpectedShareRefusal(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === 'AbortError'        // человек закрыл шторку
    || name === 'NotAllowedError'     // браузер отказал (нет жеста/десктоп)
    || name === 'NotSupportedError'   // тип файла не шарится
    || name === 'SecurityError';      // небезопасный контекст
}

function getLocale(): string {
  return localStorage.getItem(STORAGE_KEYS.APP_LANGUAGE) || 'ru';
}

function buildHeader(session: ArchiveSession, s: ExportStrings): string {
  const date = toDate(session.createdAt) ?? new Date();
  const title = (!isBlankTitle(session.title) ? session.title!.trim() : undefined) || s.untitled;
  return [
    title,
    date.toLocaleDateString(getLocale(), { day: 'numeric', month: 'long', year: 'numeric' }),
    `${session.wordCount} ${s.words} · ${Math.round((session.duration || 0) / 60)} ${s.time}`,
    session.tags?.length ? session.tags.map(t => '#' + t).join(' ') : '',
  ].filter(Boolean).join('\n');
}

export function getFilenameBase(session: ArchiveSession, s: ExportStrings): string {
  const title = (!isBlankTitle(session.title) ? session.title!.trim() : undefined) || s.untitledFilename;
  return title
    .replace(/[^\w\sа-яёА-ЯЁ-]/gi, '')
    .trim()
    .slice(0, 50) || s.untitledFilename;
}

function getFilename(session: ArchiveSession, ext: string, s: ExportStrings): string {
  return `${getFilenameBase(session, s)}.${ext}`;
}

export function buildMarkdownContent(session: ArchiveSession, s: ExportStrings): string {
  const date = toDate(session.createdAt) ?? new Date();
  return serializeNoteMarkdown({
    title: (!isBlankTitle(session.title) ? session.title!.trim() : undefined) || s.untitled,
    date: date.toISOString(),
    tags: session.tags,
    mood: session.mood,
    content: session.content || '',
  });
}

export function sessionToMarkdown(session: ArchiveSession, s: ExportStrings): string {
  return buildMarkdownContent(session, s);
}

async function downloadBlob(content: string | Blob, type: string, filename: string): Promise<void> {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  
  if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && typeof navigator.share === 'function') {
    try {
      const file = new File([blob], filename, { type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename,
        });
        return;
      }
    } catch (e) {
      // R7Q-028: человек сам закрыл шторку — это не «шторки нет». Прежний белый
      // список проглатывал AbortError и файл улетал в загрузки после отмены.
      if ((e as { name?: unknown } | null)?.name === 'AbortError') return;
      // Прочие ожидаемые отказы — ниже сработает загрузка файла.
      if (!isExpectedShareRefusal(e)) {
        reportError(e, { action: 'archive_export_share' });
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// A locked / undecryptable / unreadable session carries content: '' — exporting it
// would produce a file with a header and no text. Mirrors the flag check the bulk
// export already does (ExportAllService).
// Причина отказа — ключ текста, один на превью и лист телефона; null — можно.
// Запертая заметка несёт и `_contentNotLoaded`, поэтому замок проверяется первым (R7F-023).
export function exportRefusalKey(session: ArchiveSession): 'archive_export_locked' | 'archive_export_encrypted_unavailable' | 'archive_content_load_error' | 'archive_export_not_loaded' | null {
  if (session._locked) return 'archive_export_locked';
  if (session._decryptionError) return 'archive_export_encrypted_unavailable';
  if (session._contentError) return 'archive_content_load_error';
  if (session._contentNotLoaded) return 'archive_export_not_loaded';
  return null;
}

export async function exportAsTxt(session: ArchiveSession, s: ExportStrings): Promise<void> {
  const content = [
    buildHeader(session, s),
    '',
    '─'.repeat(40),
    '',
    session.content || '',
  ].join('\n');
  await downloadBlob(content, 'text/plain;charset=utf-8', getFilename(session, 'txt', s));
}

export async function exportAsMd(session: ArchiveSession, s: ExportStrings): Promise<void> {
  const content = sessionToMarkdown(session, s);
  await downloadBlob(content, 'text/markdown;charset=utf-8', getFilename(session, 'md', s));
}

export function stripMarkdown(md: string): string {
  if (!md) return '';
  const frontMatterMatch = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (frontMatterMatch) {
    const frontMatter = frontMatterMatch[0];
    const body = md.slice(frontMatter.length);
    return frontMatter + stripMarkdownBody(body);
  }
  return stripMarkdownBody(md);
}

function stripMarkdownBody(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/^(?:#+)\s+(.*)$/gm, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/^(?:-{3,}|\*{3,}|_{3,})$/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '');
}

export function exportAsPdf(session: ArchiveSession, s: ExportStrings): void {
  const date = toDate(session.createdAt) ?? new Date();
  const locOpts = getLocale();
  const untitled = s.untitled;
  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(locOpts)}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(session.title || untitled)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
      font-size: 13pt;
      line-height: 1.8;
      color: #1a1a1a;
      padding: 40mm 30mm;
      max-width: 800px;
      margin: 0 auto;
    }
    h1 { font-size: 22pt; font-weight: 500; margin-bottom: 8pt; letter-spacing: -0.02em; }
    .meta { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 9pt; color: #888; margin-bottom: 24pt; letter-spacing: 0.04em; text-transform: uppercase; }
    .divider { border: none; border-top: 1px solid #e0e0e0; margin: 20pt 0; }
    .content { white-space: pre-wrap; word-break: break-word; }
    .tags { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 9pt; color: #aaa; margin-top: 20pt; }

    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(session.title || untitled)}</h1>
  <div class="meta">
    ${date.toLocaleDateString(locOpts, { day: 'numeric', month: 'long', year: 'numeric' })} &nbsp;·&nbsp;
    ${session.wordCount} ${escapeHtml(s.words)} &nbsp;·&nbsp;
    ${Math.round((session.duration || 0) / 60)} ${escapeHtml(s.time)}
  </div>
  <hr class="divider">
  <div class="content">${escapeHtml(session.content || '')}</div>
  ${session.tags?.length ? `<div class="tags">${session.tags.map(t => '#' + escapeHtml(t)).join(' ')}</div>` : ''}
</body>
</html>`;

  const isMobile = typeof window !== 'undefined' && (window.matchMedia('(max-width: 768px)').matches || window.matchMedia('(hover: none)').matches);

  if (isMobile) {
    const filename = getFilename(session, 'html', s);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const file = new File([blob], filename, { type: 'text/html' });
      const shareData: { title: string; files?: File[]; text?: string } = {
        title: session.title || s.untitled,
      };

      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        shareData.files = [file];
      } else {
        shareData.text = session.content || '';
      }

      navigator.share(shareData).catch((err: unknown) => {
        if (!isExpectedShareRefusal(err)) {
          reportError(err, { action: 'archive_export_share_fallback' });
        }
        void downloadBlob(html, 'text/html;charset=utf-8', filename);
      });
    } else {
      void downloadBlob(html, 'text/html;charset=utf-8', filename);
    }
  } else {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, '_blank');

    if (win) {
      // N-16: печать зовём отсюда. Встроенный <script> в blob-документе не
      // выполнялся: blob наследует CSP страницы (script-src 'self').
      win.addEventListener('load', () => { win.focus(); win.print(); }, { once: true });
      try {
        win.opener = null;
      } catch {
        /* cross-origin guard */
      }
      win.focus();
    } else {
      console.warn('Popup blocked — falling back to html download');
      void downloadBlob(html, 'text/html;charset=utf-8', getFilename(session, 'html', s));
    }
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 60000);
  }
}

export async function exportAsDocx(session: ArchiveSession, s: ExportStrings): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  const date = toDate(session.createdAt) ?? new Date();
  const locOpts = getLocale();
  const metaText = [
    date.toLocaleDateString(locOpts, { day: 'numeric', month: 'long', year: 'numeric' }),
    `${session.wordCount} ${s.words}`,
    `${Math.round((session.duration || 0) / 60)} ${s.time}`,
    session.tags?.length ? session.tags.map(t => '#' + t).join(' ') : '',
  ].filter(Boolean).join('  ·  ');

  const contentParagraphs = (session.content || '')
    .split('\n')
    .map(line => new Paragraph({
      children: [new TextRun({ text: line, font: 'Georgia', size: 24 })],
      spacing: { after: line.trim() === '' ? 0 : 160 },
    }));

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          text: session.title || s.untitled,
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 120 },
        }),
        new Paragraph({
          children: [new TextRun({ text: metaText, color: '888888', size: 18, font: 'Calibri' })],
          spacing: { after: 400 },
        }),
        new Paragraph({
          children: [new TextRun({ text: '─'.repeat(40), color: 'cccccc', size: 16 })],
          spacing: { after: 400 },
        }),
        ...contentParagraphs,
        ...(session.tags?.length ? [new Paragraph({
          children: [new TextRun({ text: session.tags.map(t => '#' + t).join(' '), color: 'aaaaaa', size: 18, font: 'Calibri' })],
          spacing: { before: 400 },
        })] : []),
      ],
    }],
  });

  const buffer = await Packer.toBlob(doc);
  await downloadBlob(buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', getFilename(session, 'docx', s));
}
