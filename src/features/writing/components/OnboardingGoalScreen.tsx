import { useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { Button } from '../../../shared/components/Button';

interface OnboardingGoalScreenProps {
  onComplete: (wordGoal: number) => void;
  setWordGoal: (goal: number) => void;
}

const PRESETS = [
  { key: 'easy', words: 100, mins: 2 },
  { key: 'normal', words: 300, mins: 7 },
  { key: 'serious', words: 750, mins: 15 },
] as const;

export function OnboardingGoalScreen({ onComplete, setWordGoal }: OnboardingGoalScreenProps) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<number | null>(null);
  const [customWords, setCustomWords] = useState('');
  const [isCustom, setIsCustom] = useState(false);

  const goal = isCustom ? (parseInt(customWords) || 0) : selected;

  const handleSelect = (words: number) => {
    setSelected(words);
    setIsCustom(false);
  };

  const handleCustom = () => {
    setIsCustom(true);
    setSelected(null);
  };

  const handleStart = () => {
    const finalGoal = isCustom ? (parseInt(customWords) || 300) : (selected || 300);
    setWordGoal(finalGoal);
    localStorage.setItem('onboarding_done', '1');
    onComplete(finalGoal);
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md space-y-8"
      >
        <div className="text-center">
          <h2 className="text-2xl font-bold text-text-main">{t('onboarding_goal_title')}</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {PRESETS.map(preset => (
            <Button
              key={preset.key}
              variant={selected === preset.words && !isCustom ? 'brand' : 'ghost'}
              size="lg"
              onClick={() => handleSelect(preset.words)}
              className={cn(
                "flex flex-col items-center gap-2 p-5 rounded-2xl border transition-colors",
                selected === preset.words && !isCustom
                  ? "border-brand-primary bg-brand-primary/10 ring-2 ring-brand-primary/30"
                  : "border-border-subtle bg-text-main/[0.02] hover:bg-text-main/5"
              )}
            >
              <div className="text-xl font-mono font-bold text-text-main tabular-nums">{preset.words}</div>
              <div className="text-label-sm font-bold uppercase tracking-widest text-text-main/60">
                {t(`onboarding_goal_${preset.key}`)}
              </div>
              <div className="text-label text-text-main/60">
                ≈ {preset.mins} {t('goal_time_min')}
              </div>
            </Button>
          ))}

          <Button
            variant={isCustom ? 'brand' : 'ghost'}
            size="lg"
            onClick={handleCustom}
            className={cn(
              "flex flex-col items-center gap-2 p-5 rounded-2xl border transition-colors",
              isCustom
                ? "border-brand-primary bg-brand-primary/10 ring-2 ring-brand-primary/30"
                : "border-border-subtle bg-text-main/[0.02] hover:bg-text-main/5"
            )}
          >
            {isCustom ? (
              <input
                type="number"
                value={customWords}
                onChange={e => setCustomWords(e.target.value)}
                placeholder="500"
                autoFocus
                className="w-20 text-center text-xl font-mono font-bold bg-transparent border-b border-brand-primary outline-none text-text-main placeholder:text-text-main/40"
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <div className="text-xl font-mono font-bold text-text-main tabular-nums">✎</div>
            )}
            <div className="text-label-sm font-bold uppercase tracking-widest text-text-main/60">
              {t('onboarding_goal_custom')}
            </div>
          </Button>
        </div>

        <div className="text-center">
          <Button
            variant="primary"
            size="lg"
            onClick={handleStart}
            disabled={!goal || goal <= 0}
            className="px-8 py-3.5 rounded-2xl font-bold text-sm"
          >
            {t('onboarding_goal_cta')}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
