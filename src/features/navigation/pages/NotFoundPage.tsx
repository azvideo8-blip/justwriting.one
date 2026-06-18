import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../../shared/i18n';
import { SeoHead } from '../../../shared/i18n/SeoHead';

export function NotFoundPage() {
  const { language } = useLanguage();
  const isRu = language === 'ru';

  return (
    <div className="max-w-md mx-auto py-8 px-4">
      <SeoHead
        path="/404"
        titleRu="Страница не найдена — justwriting"
        titleEn="Page not found — justwriting"
        descriptionRu="Запрашиваемая страница не существует."
        descriptionEn="The requested page does not exist."
      />
      <div className="text-center">
        <h1 className="text-6xl font-black text-text-main mb-4">404</h1>
        <p className="text-sm text-text-main/60 mb-8">
          {isRu ? 'Запрашиваемая страница не существует.' : 'The requested page does not exist.'}
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-text-main/60 hover:text-text-main transition-colors"
        >
          <ArrowLeft size={16} />
          {isRu ? 'На главную' : 'Back to home'}
        </Link>
      </div>
    </div>
  );
}
