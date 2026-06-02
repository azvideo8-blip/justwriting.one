import React from 'react';
import { Download, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { ExportService } from '../../export/ExportService';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { Button } from '../../../shared/components/Button';

interface FinishModalExportProps {
  title: string;
  content: string;
  t: (k: string) => string;
  isMobile: boolean;
  exportExpanded: boolean;
  setExportExpanded: (v: boolean) => void;
}

export function FinishModalExport({
  title,
  content,
  t,
  isMobile,
  exportExpanded,
  setExportExpanded,
}: FinishModalExportProps) {
  const { execute } = useServiceAction();

  const exportPDF = () => ExportService.toPDF(title || 'Untitled', content);
  const exportMarkdown = () => ExportService.toMarkdown(title || 'Untitled', content);
  const exportDocx = () => {
    void execute(() => ExportService.toDocx(title || 'Untitled', content), { errorMessage: t('error_export_failed') });
  };

  if (isMobile) {
    return (
      <div className="border border-border-subtle rounded-2xl overflow-hidden bg-surface-base/10">
        <Button
          variant="ghost"
          size="md"
          onClick={() => setExportExpanded(!exportExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between bg-surface-base/20 hover:bg-surface-base/30 font-semibold text-sm"
        >
          <span>{t('session_export') || 'Export'}</span>
          {exportExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </Button>

        {exportExpanded && (
          <div className="p-4">
            <div className="grid grid-cols-3 gap-3">
              <Button type="button" onClick={exportPDF} className="flex flex-col items-center justify-center gap-2 p-3 transition-colors rounded-xl bg-surface-base hover:bg-text-main/10 border border-border-subtle min-h-[56px]">
                <FileText size={18} className="text-text-main/70" />
                <span className="text-label font-bold text-text-main/70">PDF</span>
              </Button>
              <Button type="button" onClick={exportMarkdown} className="flex flex-col items-center justify-center gap-2 p-3 transition-colors rounded-xl bg-surface-base hover:bg-text-main/10 border border-border-subtle min-h-[56px]">
                <FileText size={18} className="text-text-main/70" />
                <span className="text-label font-bold text-text-main/70">MD</span>
              </Button>
              <Button type="button" onClick={exportDocx} className="flex flex-col items-center justify-center gap-2 p-3 transition-colors rounded-xl bg-surface-base hover:bg-text-main/10 border border-border-subtle min-h-[56px]">
                <Download size={18} className="text-text-main/70" />
                <span className="text-label font-bold text-text-main/70">DOCX</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-label-sm font-bold uppercase tracking-widest text-text-main/50">{t('session_export')}</div>
      <div className="grid grid-cols-3 gap-3">
        <Button type="button" onClick={exportPDF} className="flex flex-col items-center gap-2 p-3 transition-colors rounded-2xl bg-surface-base hover:bg-text-main/10 border border-border-subtle">
          <FileText size={18} className="text-text-main/70" />
          <span className="text-label font-bold text-text-main/70">PDF</span>
        </Button>
        <Button type="button" onClick={exportMarkdown} className="flex flex-col items-center gap-2 p-3 transition-colors rounded-2xl bg-surface-base hover:bg-text-main/10 border border-border-subtle">
          <FileText size={18} className="text-text-main/70" />
          <span className="text-label font-bold text-text-main/70">MD</span>
        </Button>
        <Button type="button" onClick={exportDocx} className="flex flex-col items-center gap-2 p-3 transition-colors rounded-2xl bg-surface-base hover:bg-text-main/10 border border-border-subtle">
          <Download size={18} className="text-text-main/70" />
          <span className="text-label font-bold text-text-main/70">DOCX</span>
        </Button>
      </div>
    </div>
  );
}
