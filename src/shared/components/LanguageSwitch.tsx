import { useLanguage } from '../i18n';
import { Button } from './Button';
import { cn } from '../utils/cn';

/**
 * U-28 (решение владельца 2026-10-18): один переключатель языка на токенах.
 * Вид — сетка с инверсией выбранного, как в десктопной вкладке «Редактор»
 * (`EditorTab.tsx:220-232`); раньше телефон использовал `bg-white/[0.04]` и
 * `bg-white/[0.08]`, в тёплой теме «notion» контрол пропадал совсем.
 */
export function LanguageSwitch() {
  const { t, language, setLanguage } = useLanguage();
  return (
    <div
      data-testid="language-switch"
      role="group"
      aria-label={t('settings_language')}
      className="grid grid-cols-2 gap-2"
    >
      {(['ru', 'en'] as const).map(lang => (
        <Button
          key={lang}
          type="button"
          onClick={() => setLanguage(lang)}
          aria-pressed={language === lang}
          className={cn(
            'min-h-11 rounded-xl border text-sm font-medium transition-colors',
            language === lang
              ? 'border-text-main bg-text-main text-surface-base'
              : 'border-border-subtle text-text-main/60 hover:text-text-main',
          )}
        >
          {lang === 'ru' ? t('settings_language_russian') : t('settings_language_english')}
        </Button>
      ))}
    </div>
  );
}
