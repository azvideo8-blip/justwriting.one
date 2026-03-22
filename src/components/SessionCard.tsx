import React, { useState } from 'react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { 
  Clock, Type, PenLine, Globe, Lock, Share2, 
  ChevronDown, ChevronUp, X, User as UserIcon,
  FileText, Download, FileJson
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Session } from '../types';
import { parseFirestoreDate, cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';

import { SessionEditor } from './SessionEditor';

export function SessionCard({ session, showAuthor, onContinue }: { session: Session, showAuthor?: boolean, onContinue?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const exportToTxt = () => {
    const blob = new Blob([session.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.title || 'session'}_${format(parseFirestoreDate(session.createdAt), 'yyyy-MM-dd')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const splitTitle = doc.splitTextToSize(session.title || 'Untitled Session', 180);
    const splitContent = doc.splitTextToSize(session.content, 180);
    
    doc.setFontSize(20);
    doc.text(splitTitle, 15, 20);
    doc.setFontSize(12);
    doc.text(splitContent, 15, 40);
    doc.save(`${session.title || 'session'}.pdf`);
    setShowExportMenu(false);
  };

  const exportMarkdown = () => {
    const md = `# ${session.title || 'Untitled Session'}\n\n${session.content}`;
    const blob = new Blob([md], { type: 'text/markdown' });
    saveAs(blob, `${session.title || 'session'}.md`);
    setShowExportMenu(false);
  };

  const exportDocx = async () => {
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: session.title || 'Untitled Session',
                bold: true,
                size: 32,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: session.content,
                size: 24,
              }),
            ],
          }),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${session.title || 'session'}.docx`);
    setShowExportMenu(false);
  };

  const sessionDate = parseFirestoreDate(session.createdAt);

  return (
    <motion.div 
      layout
      className="bg-white dark:bg-stone-900 p-6 md:p-8 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm hover:shadow-md transition-all space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {showAuthor && (
            <div className="w-8 h-8 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center overflow-hidden border border-stone-100 dark:border-stone-800">
              {session.authorPhoto ? (
                <img src={session.authorPhoto} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon size={14} className="text-stone-400" />
              )}
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-[10px] md:text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">
              {format(new Date(sessionDate), 'd MMM yyyy • HH:mm')}
            </span>
            {showAuthor && <span className="font-medium text-stone-900 dark:text-stone-100">{session.isAnonymous ? 'Аноним' : (session.nickname || session.authorName)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-4 text-stone-400 dark:text-stone-500 text-xs md:text-sm font-mono">
          <span className="flex items-center gap-1" title="Время"><Clock size={14} /> {Math.floor(session.duration / 60)}м</span>
          <span className="flex items-center gap-1" title="Слова"><Type size={14} /> {session.wordCount}сл</span>
          <span className="flex items-center gap-1" title="Символы"><PenLine size={14} /> {session.charCount || 0}</span>
          {session.isPublic ? <Globe size={14} /> : <Lock size={14} />}
          <div className="flex items-center gap-1 ml-2 relative">
            <button 
              onClick={() => setShowExportMenu(!showExportMenu)}
              className={cn(
                "p-1 transition-colors",
                showExportMenu ? "text-stone-900 dark:text-stone-100" : "hover:text-stone-900 dark:hover:text-stone-100"
              )}
              title="Экспорт"
            >
              <Share2 size={16} />
            </button>

            {showExportMenu && (
              <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-stone-800 rounded-2xl shadow-xl border border-stone-100 dark:border-stone-700 p-2 z-20"
              >
                <button 
                  onClick={exportToTxt}
                  className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700 rounded-xl transition-all"
                >
                  <FileText size={14} />
                  Текстовый (.txt)
                </button>
                <button 
                  onClick={exportPDF}
                  className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700 rounded-xl transition-all"
                >
                  <FileText size={14} className="text-red-500" />
                  PDF (.pdf)
                </button>
                <button 
                  onClick={exportMarkdown}
                  className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700 rounded-xl transition-all"
                >
                  <FileJson size={14} className="text-blue-500" />
                  Markdown (.md)
                </button>
                <button 
                  onClick={exportDocx}
                  className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700 rounded-xl transition-all"
                >
                  <Download size={14} className="text-emerald-500" />
                  Word (.docx)
                </button>
              </motion.div>
            )}

            {!showAuthor && auth.currentUser?.uid === session.userId && (
              <button 
                onClick={() => setIsEditing(!isEditing)}
                className="p-1 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
              >
                <PenLine size={16} />
              </button>
            )}
            <button 
              onClick={() => setExpanded(!expanded)}
              className="p-1 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
            >
              {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          </div>
        </div>
      </div>

      {session.title && !isEditing && (
        <h4 className="text-xl font-bold dark:text-stone-100">{session.title}</h4>
      )}

      {isEditing ? (
        <SessionEditor 
          session={session} 
          onCancel={() => setIsEditing(false)} 
          onSave={() => setIsEditing(false)} 
        />
      ) : (
        <div className={cn("relative", !expanded && "max-h-24 overflow-hidden")}>
          <p className="text-stone-600 dark:text-stone-300 leading-relaxed whitespace-pre-wrap">
            {session.content}
          </p>
          {!expanded && session.content.length > 200 && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white dark:from-stone-900 to-transparent" />
          )}
        </div>
      )}

      {!isEditing && (
        <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-stone-100 dark:border-stone-800">
          <div className="flex flex-wrap gap-2">
            {session.tags && session.tags.length > 0 ? (
              session.tags.map(tag => (
                <span key={tag} className="text-xs font-medium text-stone-400">#{tag}</span>
              ))
            ) : (
              <span className="text-xs text-stone-300 dark:text-stone-600 italic">Нет тегов</span>
            )}
          </div>
          
          {onContinue && auth.currentUser?.uid === session.userId && (
            <button 
              onClick={onContinue}
              className="flex items-center gap-2 px-6 py-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 rounded-xl font-bold hover:opacity-90 transition-opacity text-sm"
            >
              <PenLine size={16} />
              Продолжить писать
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
