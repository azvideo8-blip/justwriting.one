import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { FileText, Download, FileJson } from 'lucide-react';
import { Session } from '../../../types';
import { ExportService } from '../../export/ExportService';
import { useLanguage } from '../../../shared/i18n';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { Button } from '../../../shared/components/Button';

interface ExportMenuProps {
  session: Session;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

export function ExportMenu({ session, buttonRef, onClose }: ExportMenuProps) {
  const { t } = useLanguage();
  const { execute } = useServiceAction();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + window.scrollY + 8,
        right: window.innerWidth - rect.right
      });
    }
  }, [buttonRef]);

  useEffect(() => {
    const handleClickOutside = (e: PointerEvent) => {
      const clickedButton = buttonRef.current?.contains(e.target as Node);
      const clickedMenu = menuRef.current?.contains(e.target as Node);
      if (!clickedButton && !clickedMenu) {
        onClose();
      }
    };
    document.addEventListener('pointerup', handleClickOutside);
    return () => document.removeEventListener('pointerup', handleClickOutside);
  }, [buttonRef, onClose]);

  if (!menuPos) return null;

  const menuStyle = {
    position: 'fixed' as const,
    top: menuPos.top,
    right: menuPos.right,
    zIndex: 9999,
  };

  const exportToTxt = () => {
    ExportService.toTxt(session.title || 'session', session.content, new Date());
    onClose();
  };
  const exportPDF = () => {
    ExportService.toPDF(session.title || 'Untitled Session', session.content);
    onClose();
  };
  const exportMarkdown = () => {
    ExportService.toMarkdown(session.title || 'Untitled Session', session.content);
    onClose();
  };
  const exportDocx = () => {
    void execute(
      () => ExportService.toDocx(session.title || 'Untitled Session', session.content),
      { errorMessage: t('error_export_failed') }
    );
  };

  return createPortal(
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      style={menuStyle}
      className="w-48 rounded-2xl shadow-xl border p-2 bg-surface-card backdrop-blur-xl border-border-subtle"
    >
      <Button onClick={exportToTxt} className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold rounded-2xl transition-colors text-text-main/70 hover:bg-white/10 hover:text-text-main">
        <FileText size={14} /> {t('export_txt')}
      </Button>
      <Button onClick={exportPDF} className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold rounded-2xl transition-colors text-text-main/70 hover:bg-white/10 hover:text-text-main">
        <FileText size={14} className="text-accent-danger" /> {t('export_pdf')}
      </Button>
      <Button onClick={exportMarkdown} className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold rounded-2xl transition-colors text-text-main/70 hover:bg-white/10 hover:text-text-main">
        <FileJson size={14} className="text-blue-500" /> {t('export_md')}
      </Button>
      <Button onClick={exportDocx} className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold rounded-2xl transition-colors text-text-main/70 hover:bg-white/10 hover:text-text-main">
        <Download size={14} className="text-emerald-500" /> {t('export_docx')}
      </Button>
    </motion.div>,
    document.body
  );
}
