import { AIService } from '../AIService';
import { AIThemeLedgerService } from '../AIThemeLedgerService';
import { cosineSimilarity } from '../../utils/vectorSearch';
import { hasIndexingConsent } from '../../../../core/ai/indexingConsent';
import { looksLikeAggregateQuery } from '../../utils/aiChatTransport';
import { reportError } from '../../../../shared/errors/reportError';
import { reportAIDegradation, isDailyLimitError } from '../../utils/aiDegradationReporter';

interface AggregateDeps {
  effectiveQuery: string;
  queryEmb: number[] | undefined;
  uid: string | undefined;
  onDailyLimitError: () => void;
}

/** Блок точной статистики по реестру тем; null — запрос не агрегатный. */
export async function buildAggregateThemeBlock(deps: AggregateDeps): Promise<string | null> {
  const { effectiveQuery, uid } = deps;
  let queryEmb = deps.queryEmb;
  if (!looksLikeAggregateQuery(effectiveQuery)) return null;
  try {
    const activeThemes = await AIThemeLedgerService.getActive();
    const queryLower = effectiveQuery.toLowerCase();

    let localQueryEmb = queryEmb;
    if (!localQueryEmb && hasIndexingConsent(uid)) {
      const embResult = await AIService.embed({ content: effectiveQuery });
      if (!embResult.ok) {
        if (isDailyLimitError(embResult.error)) {
          deps.onDailyLimitError();
        }
        reportAIDegradation({
          feature: 'chat_aggregate_embed',
          cause: embResult.error,
          action: 'Поиск по реестру тем',
          impact: 'Статистика по темам недоступна',
        });
      }
      localQueryEmb = embResult.ok && embResult.vectors[0] ? embResult.vectors[0] : undefined;
    }

    const scoredThemes = activeThemes.map(t => {
      let score = 0;
      if (localQueryEmb && t.themeVector?.length > 0) {
        score = cosineSimilarity(localQueryEmb, t.themeVector);
      }
      if (queryLower.includes(t.theme.toLowerCase())) {
        // DY10-8: у темы с другого устройства вектора нет — имя в вопросе решает само.
        score += t.themeVector?.length > 0 ? 0.2 : 1;
      }
      return { ...t, score };
    })
    .filter(t => t.score > 0.7)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

    if (scoredThemes.length > 0) {
      const themeStats = scoredThemes.map(t => {
        return `- Тема "${t.theme}": упоминалась ${t.count} раз. Впервые: ${new Date(t.firstSeenAt).toLocaleDateString('ru-RU')}, последний раз: ${new Date(t.lastReinforcedAt).toLocaleDateString('ru-RU')}.\n  Контекст: ${t.evidence.map(e => e.sentence).join('; ')}`;
      }).join('\n\n');
      return `\n\n[ТОЧНАЯ СТАТИСТИКА ПО ВСЕЙ БАЗЕ ЗАМЕТОК, НЕ ТРЕБУЕТ ОЦЕНОК]\n${themeStats}\n(Используй только эти точные цифры для ответа на вопросы о частоте или количестве. Не пытайся экстраполировать количество на основе найденных ниже примеров записей.)`;
    } else {
      return `\n\n[ТОЧНАЯ СТАТИСТИКА ПО ВСЕЙ БАЗЕ ЗАМЕТОК, НЕ ТРЕБУЕТ ОЦЕНОК]\nВ базе нет точных данных (ledger) по запрашиваемой теме. Честно сообщи пользователю, что точной статистики нет (не пытайся угадывать число по отдельным заметкам ниже).`;
    }
  } catch (e) {
    reportError(e, { action: '[useAIChatContext] aggregate query failed' });
    // Without a block the model falls back to counting the top-K notes
    // below and states a number — the ledger being unreadable must not
    // turn into a confident count, or into "you never wrote about this".
    return `\n\n[ТОЧНАЯ СТАТИСТИКА ПО ВСЕЙ БАЗЕ ЗАМЕТОК НЕДОСТУПНА]\nНе удалось прочитать реестр тем. Скажи, что не можешь сейчас посчитать точно, и не называй никаких чисел — ни своих, ни выведенных из примеров записей ниже.`;
  }
}
