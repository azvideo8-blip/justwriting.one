import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import { format } from 'date-fns';

export class ExportService {
  static toTxt(title: string, content: string, createdAt: Date) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'session'}_${format(createdAt, 'yyyy-MM-dd')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  static toPDF(title: string, content: string) {
    const doc = new jsPDF();
    const splitTitle = doc.splitTextToSize(title || 'Untitled Session', 180);
    const splitContent = doc.splitTextToSize(content, 180);
    
    doc.setFontSize(20);
    doc.text(splitTitle, 15, 20);
    doc.setFontSize(12);
    doc.text(splitContent, 15, 40);
    doc.save(`${title || 'session'}.pdf`);
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
