import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import { format } from 'date-fns';

export class ExportService {
  static toTxt(title: string, content: string, createdAt: Date) {
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
  }

  static toPDF(title: string, content: string) {
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <title>${title || 'Session'}</title>
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
        <h1>${title || 'Untitled Session'}</h1>
        <pre>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
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
  }

  static toMarkdown(title: string, content: string) {
    const md = `# ${title || 'Untitled Session'}\n\n${content}`;
    const blob = new Blob([md], { type: 'text/markdown' });
    saveAs(blob, `${title || 'session'}.md`);
  }

  static async toDocx(title: string, content: string) {
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
  }
}
