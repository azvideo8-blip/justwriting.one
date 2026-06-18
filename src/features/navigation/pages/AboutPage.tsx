import { ArrowLeft, Heart, Shield, FileText } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { useLanguage } from '../../../shared/i18n';
import { SeoHead } from '../../../shared/i18n/SeoHead';
import { Button } from '../../../shared/components/Button';

export function AboutPage() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const isRu = language === 'ru';

  return (
    <div className="max-w-md mx-auto py-8 px-4">
      <SeoHead
        path="/about"
        titleRu="О приложении — justwriting"
        titleEn="About — justwriting"
        descriptionRu="justwriting — минималистичный редактор для фрирайтинга и потокового письма. Всё сохраняется локально, облако — опционально."
        descriptionEn="justwriting is a minimalist editor for freewriting and stream-of-consciousness writing. Everything saves locally, cloud is optional."
      />
      <Button
        onClick={() => void navigate(-1)}
        className="flex items-center gap-2 text-text-main/60 hover:text-text-main/60 text-sm mb-8 transition-colors"
      >
        <ArrowLeft size={16} />
        {t('writing_back')}
      </Button>

      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-black text-2xl bg-text-main text-surface-base mx-auto mb-4">
          J
        </div>
        <h1 className="text-xl font-bold text-text-main mb-1">justwriting</h1>
        <p className="text-sm text-text-main/60">{t('about_subtitle')}</p>
      </div>

      <div className="space-y-4">
        <div className="bg-surface-card/50 border border-border-subtle rounded-2xl p-5">
          <p className="text-sm text-text-main/60 leading-relaxed">
            {t('about_description')}
          </p>
        </div>

        <div className="bg-surface-card/50 border border-border-subtle rounded-2xl p-5 flex items-center gap-3">
          <Heart size={16} className="text-text-main/60 shrink-0" />
          <p className="text-sm text-text-main/60">
            {t('about_made_with_love')}
          </p>
        </div>

        <div className="bg-surface-card/50 border border-border-subtle rounded-2xl p-5 space-y-3">
          <Link to="/privacy" className="flex items-center gap-3 text-sm text-text-main/60 hover:text-text-main transition-colors">
            <Shield size={16} className="text-text-main/60 shrink-0" />
            {isRu ? 'Политика конфиденциальности' : 'Privacy Policy'}
          </Link>
          <Link to="/terms" className="flex items-center gap-3 text-sm text-text-main/60 hover:text-text-main transition-colors">
            <FileText size={16} className="text-text-main/60 shrink-0" />
            {isRu ? 'Условия использования' : 'Terms of Service'}
          </Link>
        </div>
      </div>
    </div>
  );
}
