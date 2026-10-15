import { ChevronLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '../../../shared/i18n';

/** MF-10: на телефоне у /settings нет ни «×», ни «назад» — путь только через
 *  вкладки. Липкая строка «‹ Профиль»: назад по истории, если пришли изнутри
 *  приложения, иначе — в профиль. */
export function SettingsBackRow() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  // `default` — первая запись вкладки: назад по истории увёл бы из приложения.
  const goBack = () => (location.key !== 'default' ? void navigate(-1) : void navigate('/me'));
  return (
    <div className="sticky top-0 z-20 bg-surface-base px-2 pt-[env(safe-area-inset-top,0px)]">
      <button
        type="button"
        onClick={goBack}
        className="flex min-h-11 items-center gap-1 px-2 text-sm font-medium text-text-main/80"
      >
        <ChevronLeft size={18} aria-hidden="true" />
        {t('nav_profile_short')}
      </button>
    </div>
  );
}
