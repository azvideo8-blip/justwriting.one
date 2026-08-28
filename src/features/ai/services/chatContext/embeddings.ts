import { AIService } from '../AIService';
import { isDailyLimitError } from '../../utils/aiDegradationReporter';

interface EmbedOnceDeps {
  /** Текст текущей реплики: повторные вызовы с ним же переиспользуют результат (AUDIT-M5). */
  text: string;
  /** Вызывается, когда встречена ошибка дневного лимита — хук ставит degradedReason. */
  onDailyLimitError?: () => void;
}

// AUDIT-M5: один текст за ход векторизуется ОДИН раз — повторные вызовы
// (поисковый запрос === текст реплики) переиспользуют результат.
export function createEmbedOnce(deps: EmbedOnceDeps): (content: string) => Promise<number[] | undefined> {
  const { text, onDailyLimitError } = deps;
  let turnEmbPromise: Promise<number[] | undefined> | null = null;
  return (content: string): Promise<number[] | undefined> => {
    if (content !== text) return AIService.embed({ content }).then(r => (r.ok ? r.vectors[0] : undefined));
    turnEmbPromise ??= AIService.embed({ content }).then(r => {
      if (!r.ok && isDailyLimitError(r.error)) onDailyLimitError?.();
      return r.ok ? r.vectors[0] : undefined;
    });
    return turnEmbPromise;
  };
}
