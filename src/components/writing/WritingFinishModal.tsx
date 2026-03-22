import React from 'react';
import { motion } from 'motion/react';
import { Globe, User as UserIcon, FileText, Download, FileJson } from 'lucide-react';
import { cn } from '../../lib/utils';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';

interface WritingFinishModalProps {
  status: 'idle' | 'writing' | 'paused' | 'finished';
  wordCount: number;
  seconds: number;
  wpm: number;
  formatTime: (s: number) => string;
  isPublic: boolean;
  setIsPublic: (val: boolean) => void;
  isAnonymous: boolean;
  setIsAnonymous: (val: boolean) => void;
  handleSave: () => void;
  setStatus: (status: 'idle' | 'writing' | 'paused' | 'finished') => void;
  content: string;
  title: string;
}

export function WritingFinishModal({
  status,
  wordCount,
  seconds,
  wpm,
  formatTime,
  isPublic,
  setIsPublic,
  isAnonymous,
  setIsAnonymous,
  handleSave,
  setStatus,
  content,
  title
}: WritingFinishModalProps) {
  if (status !== 'finished') return null;

  const exportPDF = () => {
    const doc = new jsPDF();
    const splitTitle = doc.splitTextToSize(title || 'Untitled Session', 180);
    const splitContent = doc.splitTextToSize(content, 180);
    
    doc.setFontSize(20);
    doc.text(splitTitle, 15, 20);
    doc.setFontSize(12);
    doc.text(splitContent, 15, 40);
    doc.save(`${title || 'session'}.pdf`);
  };

  const exportMarkdown = () => {
    const md = `# ${title || 'Untitled Session'}\n\n${content}`;
    const blob = new Blob([md], { type: 'text/markdown' });
    saveAs(blob, `${title || 'session'}.md`);
  };

  const exportDocx = async () => {
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
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-stone-900 w-full max-w-lg rounded-3xl p-8 shadow-2xl space-y-8 max-h-[90vh] overflow-y-auto no-scrollbar"
      >
        <div className="text-center space-y-2">
          <h3 className="text-2xl font-bold dark:text-stone-100">Сессия завершена!</h3>
          <p className="text-stone-500 dark:text-stone-400">Настройте параметры публикации перед сохранением.</p>
        </div>

        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl">
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Слова</div>
            <div className="text-xl font-mono font-bold dark:text-stone-100">{wordCount}</div>
          </div>
          <div className="p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl">
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Время</div>
            <div className="text-xl font-mono font-bold dark:text-stone-100">{formatTime(seconds)}</div>
          </div>
          <div className="p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl">
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">WPM</div>
            <div className="text-xl font-mono font-bold dark:text-stone-100">{wpm}</div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-stone-200 dark:bg-stone-700 rounded-full flex items-center justify-center text-stone-500 dark:text-stone-400">
                <Globe size={20} />
              </div>
              <div>
                <div className="font-bold text-sm dark:text-stone-100">Публичный доступ</div>
                <div className="text-xs text-stone-500">Ваш текст увидят другие авторы</div>
              </div>
            </div>
            <button 
              onClick={() => setIsPublic(!isPublic)}
              className={cn(
                "w-12 h-6 rounded-full p-1 transition-colors duration-300 flex items-center",
                isPublic ? "bg-emerald-500" : "bg-stone-300 dark:bg-stone-600"
              )}
            >
              <motion.div 
                animate={{ x: isPublic ? 24 : 0 }}
                className="w-4 h-4 bg-white rounded-full shadow-sm"
              />
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-stone-200 dark:bg-stone-700 rounded-full flex items-center justify-center text-stone-500 dark:text-stone-400">
                <UserIcon size={20} />
              </div>
              <div>
                <div className="font-bold text-sm dark:text-stone-100">Анонимно</div>
                <div className="text-xs text-stone-500">Скрыть ваше имя в ленте</div>
              </div>
            </div>
            <button 
              onClick={() => setIsAnonymous(!isAnonymous)}
              className={cn(
                "w-12 h-6 rounded-full p-1 transition-colors duration-300 flex items-center",
                isAnonymous ? "bg-stone-900 dark:bg-stone-100" : "bg-stone-300 dark:bg-stone-600"
              )}
            >
              <motion.div 
                animate={{ x: isAnonymous ? 24 : 0 }}
                className="w-4 h-4 bg-white dark:bg-stone-900 rounded-full shadow-sm"
              />
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Экспорт</label>
          <div className="grid grid-cols-3 gap-3">
            <button 
              onClick={exportPDF}
              className="flex flex-col items-center gap-2 p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl hover:bg-stone-100 dark:hover:bg-stone-700 transition-all"
            >
              <FileText size={20} className="text-red-500" />
              <span className="text-[10px] font-bold">PDF</span>
            </button>
            <button 
              onClick={exportMarkdown}
              className="flex flex-col items-center gap-2 p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl hover:bg-stone-100 dark:hover:bg-stone-700 transition-all"
            >
              <FileJson size={20} className="text-blue-500" />
              <span className="text-[10px] font-bold">MD</span>
            </button>
            <button 
              onClick={exportDocx}
              className="flex flex-col items-center gap-2 p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl hover:bg-stone-100 dark:hover:bg-stone-700 transition-all"
            >
              <Download size={20} className="text-emerald-500" />
              <span className="text-[10px] font-bold">DOCX</span>
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <button 
            onClick={() => setStatus('writing')}
            className="flex-1 px-6 py-4 border border-stone-200 dark:border-stone-800 rounded-2xl font-bold hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
          >
            Вернуться
          </button>
          <button 
            onClick={handleSave}
            className="flex-1 px-6 py-4 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 rounded-2xl font-bold shadow-xl hover:scale-105 transition-all"
          >
            Сохранить
          </button>
        </div>
      </motion.div>
    </div>
  );
}
