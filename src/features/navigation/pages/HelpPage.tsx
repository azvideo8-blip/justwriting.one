import React from 'react';
import { ArrowLeft, HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../../shared/i18n';
import { SeoHead } from '../../../shared/i18n/SeoHead';
import { Button } from '../../../shared/components/Button';
import { HelpTree } from '../components/HelpTree';

export function HelpPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <div className="max-w-xl mx-auto py-8 px-4">
      <SeoHead
        path="/help"
        titleRu="Помощь — justwriting"
        titleEn="Help — justwriting"
        descriptionRu="Диагностика и решение проблем: что делать, если заметки не видны."
        descriptionEn="Troubleshooting and solutions: what to do if notes are not visible."
      />
      <Button
        onClick={() => void navigate(-1)}
        className="flex items-center gap-2 text-text-main/60 hover:text-text-main text-sm mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        {t('writing_back')}
      </Button>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-surface-base/10 border border-border-subtle flex items-center justify-center text-text-main">
            <HelpCircle size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-main">{t('help_title')}</h1>
            <p className="text-xs text-text-main/60">{t('help_subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-text-main/80 uppercase tracking-wider mb-3">
            {t('help_section_notes_missing')}
          </h2>
          <HelpTree />
        </div>
      </div>
    </div>
  );
}
