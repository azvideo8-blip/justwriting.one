import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../../shared/i18n';
import { SeoHead } from '../../../shared/i18n/SeoHead';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { Button } from '../../../shared/components/Button';
import { cn } from '../../../core/utils/utils';

const features = [
  {
    icon: 'pen',
    titleRu: 'Режим потока',
    titleEn: 'Stream Mode',
    descRu: 'Backspace отключён. Ты можешь только двигаться вперёд. Чистый поток сознания без саморедактуры.',
    descEn: 'Backspace is disabled. You can only move forward. Pure stream of consciousness without self-editing.',
  },
  {
    icon: 'shield',
    titleRu: 'Сквозное шифрование',
    titleEn: 'End-to-end encryption',
    descRu: 'Заметки зашифрованы на устройстве. Сервер не может их прочитать. Твои слова — только твои.',
    descEn: 'Notes are encrypted on your device. The server cannot read them. Your words are yours alone.',
  },
  {
    icon: 'streak',
    titleRu: 'Серия дней',
    titleEn: 'Writing streaks',
    descRu: 'Пиши каждый день и наблюдай, как растёт серия. Регулярность важнее вдохновения.',
    descEn: 'Write every day and watch your streak grow. Consistency beats inspiration.',
  },
  {
    icon: 'zen',
    titleRu: 'Дзен-режим',
    titleEn: 'Zen Mode',
    descRu: 'Интерфейс исчезает, когда ты пишешь. Возвращается, когда останавливаешься. Тишина для слов.',
    descEn: 'The interface fades away while you write. Returns when you stop. Silence for words.',
  },
  {
    icon: 'timer',
    titleRu: 'Таймер и цели',
    titleEn: 'Timer and goals',
    descRu: 'Установи цель по словам или времени. 15 минут, 500 слов — и ты в потоке.',
    descEn: 'Set a word or time goal. 15 minutes, 500 words — and you are in the flow.',
  },
  {
    icon: 'cloud',
    titleRu: 'Облако — опционально',
    titleEn: 'Cloud is optional',
    descRu: 'Всё хранится локально. Облачная синхронизация — когда ты готов, а не когда приложение решит.',
    descEn: 'Everything is stored locally. Cloud sync when you are ready, not when the app decides.',
  },
];

const iconMap: Record<string, string> = {
  pen: '✎',
  shield: '◆',
  streak: '●',
  zen: '○',
  timer: '◷',
  cloud: '◇',
};

export function LandingPage() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const isRu = language === 'ru';

  return (
    <div className="min-h-screen bg-surface-base text-text-main">
      <SeoHead
        path="/features"
        titleRu="Возможности — justwriting"
        titleEn="Features — justwriting"
        descriptionRu="Режим потока, сквозное шифрование, серия дней, дзен-режим. Тихий редактор для свободного письма."
        descriptionEn="Stream mode, end-to-end encryption, writing streaks, zen mode. A quiet editor for free writing."
      />

      <header className="max-w-3xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="mb-8 flex justify-center">
          <JustWritingLogo size={72} variant="dark" showRailway showCrown className="shadow-[0_0_40px_rgba(125,79,209,0.35)] rounded-3xl" />
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
          justwriting
        </h1>
        <p className="text-lg md:text-xl text-text-main/60 max-w-xl mx-auto leading-relaxed">
          {isRu
            ? 'Тихий редактор для свободного письма. Один знак, одна буква, одна минута.'
            : 'A quiet editor for free writing. One sign, one letter, one minute.'}
        </p>
        <Button
          onClick={() => void navigate('/')}
          className="mt-8 px-8 py-3.5 rounded-xl font-bold text-white hover:brightness-110 active:scale-[0.98] transition-[filter,transform] bg-[var(--brand-primary)]"
        >
          {isRu ? 'Начать писать' : 'Start writing'}
        </Button>
      </header>

      <section className="max-w-4xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {features.map((f, i) => {
            const isHighlighted = i === 0 || i === 5;
            return (
              <div
                key={f.icon}
                className={cn(
                  "border rounded-2xl transition-[border-color]",
                  isHighlighted
                    ? i === 0
                      ? "bg-gradient-to-br from-brand-soft/[0.12] to-brand-soft/[0.03] border-brand-soft/30 md:col-span-2 p-8 flex flex-col md:flex-row md:items-center gap-6"
                      : "bg-gradient-to-br from-text-main/[0.04] to-text-main/[0.01] border-border-subtle md:col-span-2 p-8 flex flex-col md:flex-row md:items-center gap-6"
                    : "bg-surface-card/50 border border-border-subtle p-6 hover:border-brand-soft/20"
                )}
              >
                {isHighlighted ? (
                  <>
                    <div className="text-brand-soft text-4xl font-serif w-14 h-14 rounded-2xl bg-brand-soft/10 flex items-center justify-center shrink-0">
                      {iconMap[f.icon]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-bold mb-2">{isRu ? f.titleRu : f.titleEn}</h2>
                      <p className="text-sm text-text-main/70 leading-relaxed">
                        {isRu ? f.descRu : f.descEn}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-brand-soft text-xl font-serif">{iconMap[f.icon]}</span>
                      <h2 className="text-base font-bold">{isRu ? f.titleRu : f.titleEn}</h2>
                    </div>
                    <p className="text-sm text-text-main/60 leading-relaxed">
                      {isRu ? f.descRu : f.descEn}
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="max-w-2xl mx-auto px-6 pb-20 text-center">
        <h2 className="text-2xl font-serif italic text-brand-soft mb-4">
          {isRu ? 'Просто начни писать.' : 'Just start writing.'}
        </h2>
        <p className="text-sm text-text-main/60 leading-relaxed mb-8">
          {isRu
            ? 'Не нужно регистрироваться, чтобы попробовать. Открой редактор и пиши. Облако и шифрование — когда будешь готов.'
            : 'No sign-up required to try. Open the editor and write. Cloud and encryption — when you are ready.'}
        </p>
        <Button
          onClick={() => void navigate('/')}
          className="px-8 py-3.5 rounded-xl font-bold text-white hover:brightness-110 active:scale-[0.98] transition-[filter,transform] bg-[var(--brand-primary)]"
        >
          {isRu ? 'Начать писать' : 'Start writing'}
        </Button>
      </section>

      <footer className="max-w-3xl mx-auto px-6 py-8 border-t border-border-subtle text-center">
        <p className="text-xs text-text-main/60 font-mono">
          justwriting · {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
