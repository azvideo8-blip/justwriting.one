import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../../shared/i18n';
import { SeoHead } from '../../../shared/i18n/SeoHead';
import { Button } from '../../../shared/components/Button';
import type { LegalDocument } from './legalContent';

/** Общая оболочка для правовых документов: разметка одна, текст приходит
 *  данными. Три документа на двух языках, отрисованных вручную, разошлись бы
 *  между собой при первой правке. */
export function LegalPage({
  doc, path, titleRu, titleEn, descriptionRu, descriptionEn, draft = true,
}: {
  doc: LegalDocument;
  path: string;
  titleRu: string;
  titleEn: string;
  descriptionRu: string;
  descriptionEn: string;
  draft?: boolean;
}) {
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const isRu = language === 'ru';
  const content = isRu ? doc.ru : doc.en;

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <SeoHead
        path={path}
        titleRu={`${titleRu} — justwriting`}
        titleEn={`${titleEn} — justwriting`}
        descriptionRu={descriptionRu}
        descriptionEn={descriptionEn}
      />
      <Button
        onClick={() => void navigate(-1)}
        className="flex items-center gap-2 text-text-main/60 hover:text-text-main text-sm mb-8 transition-colors"
      >
        <ArrowLeft size={16} />
        {t('common_back')}
      </Button>

      <h1 className="text-2xl font-bold text-text-main mb-2">{isRu ? titleRu : titleEn}</h1>
      <p className="text-sm text-text-main/60 mb-6">
        {t('legal_last_updated', { date: content.updated })}
      </p>

      {draft && (
        /* Отметка о черновике стоит намеренно: документ ещё не прошёл
           юридическую проверку, а реквизиты оператора появятся после
           регистрации. Публиковать его как окончательный было бы неправдой. */
        <div className="mb-8 p-3 rounded-xl border border-accent-danger/40 bg-accent-danger/5 text-xs text-text-main/70 leading-relaxed">
          {t('legal_draft_notice')}
        </div>
      )}

      <div className="space-y-6 text-sm text-text-main/70 leading-relaxed">
        {content.sections.map(section => (
          <section key={section.title}>
            <h2 className="text-base font-bold text-text-main mb-2">{section.title}</h2>
            {section.paragraphs.map((p, i) => (
              <p key={i} className={i > 0 ? 'mt-2' : undefined}>{p}</p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
