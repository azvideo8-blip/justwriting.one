import { ArchiveSession } from '../types';
import { toDate } from '../../../core/utils/dateUtils';

export interface ExportStrings {
  date: string;
  words: string;
  time: string;
  tags: string;
  untitled: string;
  untitledFilename: string;
}

function buildHeader(session: ArchiveSession, s: ExportStrings): string {
  const date = toDate(session.createdAt) ?? new Date();
  return [
    session.title || s.untitled,
    date.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' }),
    `${session.wordCount} ${s.words} · ${Math.round((session.duration || 0) / 60)} ${s.time}`,
    session.tags?.length ? session.tags.map(t => '#' + t).join(' ') : '',
  ].filter(Boolean).join('\n');
}

function getFilename(session: ArchiveSession, ext: string, s: ExportStrings): string {
  const title = (session.title || s.untitledFilename)
    .replace(/[^\w\sа-яёА-ЯЁ-]/gi, '')
    .trim()
    .slice(0, 50);
  return `${title}.${ext}`;
}

function downloadBlob(content: string | Blob, type: string, filename: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportAsTxt(session: ArchiveSession, s: ExportStrings): void {
  const content = [
    buildHeader(session, s),
    '',
    '─'.repeat(40),
    '',
    session.content || '',
  ].join('\n');
  downloadBlob(content, 'text/plain;charset=utf-8', getFilename(session, 'txt', s));
}

export function exportAsMd(session: ArchiveSession, s: ExportStrings): void {
  const date = toDate(session.createdAt) ?? new Date();
  const locOpts = 'ru';
  const content = [
    `# ${session.title || s.untitled}`,
    '',
    `**${s.date}:** ${date.toLocaleDateString(locOpts, { day: 'numeric', month: 'long', year: 'numeric' })}  `,
    `**${s.words}:** ${session.wordCount}  `,
    `**${s.time}:** ${Math.round((session.duration || 0) / 60)} ${s.time}  `,
    session.tags?.length ? `**${s.tags}:** ${session.tags.map(t => '#' + t).join(' ')}` : '',
    '',
    '---',
    '',
    session.content || '',
  ].filter(line => line !== undefined).join('\n');
  downloadBlob(content, 'text/markdown;charset=utf-8', getFilename(session, 'md', s));
}

export function exportAsPdf(session: ArchiveSession, s: ExportStrings): void {
  const date = toDate(session.createdAt) ?? new Date();
  const locOpts = 'ru';
  const untitled = s.untitled;
  const html = `<!DOCTYPE html>
<html lang="${locOpts}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(session.title || untitled)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;1,400&family=Inter:wght@400;500&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Lora', Georgia, serif;
      font-size: 13pt;
      line-height: 1.8;
      color: #1a1a1a;
      padding: 40mm 30mm;
      max-width: 800px;
      margin: 0 auto;
    }
    h1 { font-size: 22pt; font-weight: 500; margin-bottom: 8pt; letter-spacing: -0.02em; }
    .meta { font-family: 'Inter', sans-serif; font-size: 9pt; color: #888; margin-bottom: 24pt; letter-spacing: 0.04em; text-transform: uppercase; }
    .divider { border: none; border-top: 1px solid #e0e0e0; margin: 20pt 0; }
    .content { white-space: pre-wrap; word-break: break-word; }
    .tags { font-family: 'Inter', sans-serif; font-size: 9pt; color: #aaa; margin-top: 20pt; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(session.title || untitled)}</h1>
  <div class="meta">
    ${date.toLocaleDateString(locOpts, { day: 'numeric', month: 'long', year: 'numeric' })} &nbsp;·&nbsp;
    ${session.wordCount} ${s.words} &nbsp;·&nbsp;
    ${Math.round((session.duration || 0) / 60)} ${s.time}
  </div>
  <hr class="divider">
  <div class="content">${escapeHtml(session.content || '')}</div>
  ${session.tags?.length ? `<div class="tags">${session.tags.map(t => '#' + t).join(' ')}</div>` : ''}
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 500);
}

export async function exportAsDocx(session: ArchiveSession, s: ExportStrings): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  const date = toDate(session.createdAt) ?? new Date();
  const locOpts = 'ru';
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
  downloadBlob(buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', getFilename(session, 'docx', s));
}
