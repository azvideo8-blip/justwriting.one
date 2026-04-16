import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import { format } from 'date-fns';
import { reportError } from '../../core/errors/reportError';

export class ExportService {
  static toJson(draft: Record<string, unknown>) {
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
      URL.revokeObjectURL(url);
    } catch (error) {
      reportError(error, { method: 'toTxt', title, contentLength: content.length });
      throw error;
    }
  }

  static toPDF(title: string, content: string) {
    try {
      const escapeHtml = (str: string) =>
        str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');

      const safeTitle = escapeHtml(title || 'Session');

      const printContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8" />
          <title>${safeTitle}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');
            body {
              font-family: 'Inter', system-ui, sans-serif;
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
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) return;
      iframeDoc.open();
      iframeDoc.write(printContent);
      iframeDoc.close();

      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();

      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
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
