import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useLanguage } from '../../../core/i18n';
import { SeoHead } from '../../../core/i18n/SeoHead';
import { CHANGELOG, type ChangelogCategory } from '../data/changelog';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { cn } from '../../../core/utils/utils';

const categoryConfig: Record<ChangelogCategory, { label: { ru: string; en: string }; className: string }> = {
  new:           { label: { ru: 'Новое',       en: 'New'          }, className: 'bg-brand-soft/15 text-brand-soft' },
  fix:           { label: { ru: 'Исправление', en: 'Fix'          }, className: 'bg-accent-danger/10 text-accent-danger' },
  improvement:   { label: { ru: 'Улучшение',   en: 'Improvement'  }, className: 'bg-accent-info/10 text-accent-info' },
  accessibility: { label: { ru: 'Доступность', en: 'Accessibility' }, className: 'bg-accent-success/10 text-accent-success' },
};

export function ChangelogPage() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const lang = language === 'ru' ? 'ru' : 'en';

  return (
    <div className="max-w-lg mx-auto py-8 px-4 pb-24">
      <SeoHead
        path="/changelog"
        titleRu="История обновлений — justwriting"
        titleEn="Release notes — justwriting"
        descriptionRu="История обновлений тихого редактора justwriting. Новые функции, исправления, улучшения."
        descriptionEn="Release notes for justwriting, a quiet writing editor. New features, fixes, improvements."
      />
      <button
        type="button"
        onClick={() => void navigate(-1)}
        className="flex items-center gap-2 text-text-main/40 hover:text-text-main/60 text-sm mb-8 transition-colors"
      >
        <ArrowLeft size={16} />
        {t('writing_back')}
      </button>

      <div className="flex items-center gap-3 mb-10">
        <JustWritingLogo size={32} variant="dark" showRailway showCrown className="shrink-0" />
        <div>
          <h1 className="text-lg font-bold text-text-main">justwriting</h1>
          <p className="text-xs text-text-main/40">{t('changelog_title')}</p>
        </div>
      </div>

      <div className="relative">
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border-subtle" />

        <div className="space-y-10">
          {CHANGELOG.map((release, i) => (
            <motion.div
              key={release.version}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="relative pl-6"
            >
              <div className={cn(
                "absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-surface-base",
                i === 0 ? "bg-brand-soft" : "bg-border-subtle"
              )} />

              <div className="flex items-baseline gap-3 mb-3">
                <span className={cn(
                  "text-sm font-mono font-bold",
                  i === 0 ? "text-brand-soft" : "text-text-main/70"
                )}>
                  v{release.version}
                </span>
                <span className="text-xs text-text-main/30 font-mono">
                  {new Date(release.date).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
                    day: 'numeric', month: 'long', year: 'numeric'
                  })}
                </span>
              </div>

              <div className="space-y-2">
                {release.items.map((item, j) => {
                  const cfg = categoryConfig[item.category];
                  return (
                    <div key={j} className="flex items-start gap-2.5">
                      <span className={cn(
                        "shrink-0 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                        cfg.className
                      )}>
                        {cfg.label[lang]}
                      </span>
                      <span className="text-sm text-text-main/70 leading-snug">
                        {item[lang]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
