import { saveAs } from 'file-saver';
import { format } from 'date-fns';
import { reportError } from '../../shared/errors/reportError';
import { escapeHtml } from '../../shared/utils/exportUtils';

export class ExportService {
  static toJson(data: unknown) {
    const draft = data as Record<string, unknown>;
    try {
      const json = JSON.stringify(draft);
      const blob = new Blob([json], { type: 'application/json' });
      saveAs(blob, `draft_backup.json`);
    } catch (error) {
      reportError(error, { method: 'toJson' });
      throw error;
    }
  }

  static toTxt(title: string, content: string, createdAt: Date) {
    try {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.style.display = 'none';
      a.download = `${title || 'session'}_${format(createdAt, 'yyyy-MM-dd')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (error) {
      reportError(error, { method: 'toTxt', title, contentLength: content.length });
      throw error;
    }
  }

  static toPDF(title: string, content: string) {
    try {
      const safeTitle = escapeHtml(title || 'Session');

      const printContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>${safeTitle}</title>
          <style>
            body {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

              font-size: 14px;
              line-height: 1.7;
              color: #1c1917;
              max-width: 680px;
              margin: 40px auto;
              padding: 0 20px;
            }
            h1 {
              font-size: 22px;
              font-weight: 700;
              margin-bottom: 24px;
              border-bottom: 1px solid #e7e5e4;
              padding-bottom: 12px;
            }
            pre {
              white-space: pre-wrap;
              word-break: break-word;
              font-family: inherit;
            }
          </style>
        </head>
        <body>
          <h1>${safeTitle}</h1>
          <pre>${escapeHtml(content)}</pre>
          <script>
            window.onload = function() {
              window.focus();
              window.print();
            };
          </script>
        </body>
        </html>
      `;

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      iframe.setAttribute('sandbox', 'allow-scripts allow-modals');
      iframe.srcdoc = printContent;
      document.body.appendChild(iframe);

      const cleanup = () => {
        if (iframe.parentNode) document.body.removeChild(iframe);
      };
      const fallbackTimer = setTimeout(cleanup, 60_000);
      iframe.addEventListener('load', () => {
        // Attach BEFORE print(): in Chrome print() blocks until the dialog
        // closes, so a listener added after it would miss the event.
        iframe.contentWindow?.addEventListener('afterprint', () => {
          clearTimeout(fallbackTimer);
          cleanup();
        }, { once: true });
        try {
          (iframe.contentWindow as Window | null)?.focus();
          (iframe.contentWindow as Window | null)?.print();
        } catch { /* cross-origin */ }
      });
    } catch (error) {
      reportError(error, { method: 'toPDF', title, contentLength: content.length });
      throw error;
    }
  }

  static toMarkdown(title: string, content: string) {
    try {
      const md = `# ${title || 'Untitled Session'}\n\n${content}`;
      const blob = new Blob([md], { type: 'text/markdown' });
      saveAs(blob, `${title || 'session'}.md`);
    } catch (error) {
      reportError(error, { method: 'toMarkdown', title, contentLength: content.length });
      throw error;
    }
  }

  static async toDocx(title: string, content: string) {
    try {
      const { Document, Packer, Paragraph, TextRun } = await import('docx');
      const doc = new Document({
        sections: [{
          properties: {},
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: title || 'Untitled Session',
                  bold: true,
                  size: 32,
                }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: content,
                  size: 24,
                }),
              ],
            }),
          ],
        }],
      });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, `${title || 'session'}.docx`);
    } catch (error) {
      reportError(error, { method: 'toDocx', title, contentLength: content.length });
      throw error;
    }
  }
}
