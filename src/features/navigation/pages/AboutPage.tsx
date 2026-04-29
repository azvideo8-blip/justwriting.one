import { ArrowLeft, Heart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../../core/i18n';

export function AboutPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <div className="max-w-md mx-auto py-8 px-4">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-text-main/40 hover:text-text-main/60 text-sm mb-8 transition-colors"
      >
        <ArrowLeft size={16} />
        {t('writing_back')}
      </button>

      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-black text-2xl bg-text-main text-surface-base mx-auto mb-4">
          J
        </div>
        <h1 className="text-xl font-bold text-text-main mb-1">justwriting</h1>
        <p className="text-sm text-text-main/40">{t('about_subtitle')}</p>
      </div>

      <div className="space-y-4">
        <div className="bg-surface-card/50 border border-border-subtle rounded-2xl p-5">
          <p className="text-sm text-text-main/60 leading-relaxed">
            {t('about_description')}
          </p>
        </div>

        <div className="bg-surface-card/50 border border-border-subtle rounded-2xl p-5 flex items-center gap-3">
          <Heart size={16} className="text-text-main/30 shrink-0" />
          <p className="text-sm text-text-main/50">
            {t('about_made_with_love')}
          </p>
        </div>
      </div>
    </div>
  );
}
