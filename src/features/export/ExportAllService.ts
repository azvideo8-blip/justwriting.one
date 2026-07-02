import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { format } from 'date-fns';
import { ArchiveSession } from '../archive/types';
import { buildMarkdownContent, getFilenameBase, ExportStrings, stripMarkdown } from '../archive/services/ArchiveExportService';
import { toDate } from '../../core/utils/dateUtils';

interface LockedFlags {
  _locked?: boolean;
  _decryptionError?: boolean;
  _contentError?: boolean;
}

export interface ExportAllResult {
  exported: number;
  skipped: number;
}

export async function exportAllAsZip(
  sessions: ArchiveSession[],
  s: ExportStrings,
): Promise<ExportAllResult> {
  const zip = new JSZip();
  const usedNames = new Set<string>();
  let exported = 0;
  let skipped = 0;

  for (const session of sessions) {
    const flags = session as LockedFlags;
    if (flags._locked || flags._decryptionError || flags._contentError) {
      skipped++;
      continue;
    }

    const date = toDate(session.createdAt) ?? new Date();
    const datePrefix = format(date, 'yyyy-MM-dd');
    const base = `${datePrefix}_${getFilenameBase(session, s)}`;

    let name = `${base}.txt`;
    let n = 2;
    while (usedNames.has(name)) {
      name = `${base}_${n}.txt`;
      n++;
    }
    usedNames.add(name);

    const mdContent = buildMarkdownContent(session, s);
    const txtContent = stripMarkdown(mdContent);
    zip.file(name, txtContent);
    exported++;
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `justwriting_backup_${format(new Date(), 'yyyy-MM-dd')}.zip`);

  return { exported, skipped };
}
