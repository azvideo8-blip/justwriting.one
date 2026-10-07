import { getLocalDb } from '../../../../core/storage/localDb';
import { AIDialogueService } from '../AIDialogueService';
import { AIMonthlyDigestService } from '../AIMonthlyDigestService';
import { AITimelineService } from '../AITimelineService';
import { reportError } from '../../../../shared/errors/reportError';
import { isExcludedFromAI } from '../../utils/isExcludedFromAI';

interface BuildProactiveBlockParams {
  personaId: string;
  turnEmb: number[] | undefined;
}

// «Что ты писал недавно» + память о прошлых сессиях. Инжектится один раз за
// сессию — флаг recentContextInjectedRef остаётся в хуке.
export async function buildProactiveBlock({ personaId, turnEmb }: BuildProactiveBlockParams): Promise<string> {
  let proactiveBlock = '';
  const shownIds = new Set<string>();
  try {
    const recentDigests = await AIMonthlyDigestService.getRecent(2);
    const db = await getLocalDb();
    const docs = await db.getAllFromIndex('documents', 'by-lastSession');
    // N-4: исключённые из ИИ и лежащие в корзине заметки сюда не попадают.
    const sortedDocs = docs.filter(d => !isExcludedFromAI(d)).sort((a, b) => (b.lastSessionAt ?? 0) - (a.lastSessionAt ?? 0));

    const recentDocSummaries: string[] = [];
    for (const doc of sortedDocs.slice(0, 3)) {
      const summary = await db.get('aiSummaries', doc.id);
      if (summary) {
        const summaryText = summary.summary || summary.tone;
        if (summaryText) {
          recentDocSummaries.push(`- «${doc.title || 'Без названия'}»: ${summaryText}`);
        }
      }
    }

    let recentBlock = '';
    const digestsPart = recentDigests.map(d => d.narrative).join('\n\n');
    const notesPart = recentDocSummaries.length > 0
      ? `\n\nПоследние заметки:\n${recentDocSummaries.join('\n')}`
      : '';
    if (digestsPart || notesPart) {
      recentBlock = `[Что ты писал недавно]\n${digestsPart}${notesPart}`;
    }

    const isPsychPersona = ['cbt', 'group_psychology'].includes(personaId);
    if (isPsychPersona) {
      const moodTrend = await AITimelineService.getMoodTrend(3);
      if (moodTrend.length > 0) {
        const monthNamesRu = [
          'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
          'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'
        ];
        const trendStr = moodTrend.map(t => {
          const parts = t.month.split('-');
          const monthIdx = parseInt(parts[1] ?? '1', 10) - 1;
          const monthName = monthNamesRu[monthIdx] ?? t.month;
          return `${monthName} — ${t.dominantTone}`;
        }).join(', ');

        recentBlock += `\n\nДинамика настроения: ${trendStr}.`;
      }
    }

    if (recentBlock) {
      proactiveBlock = recentBlock.slice(0, 2000);
    }
  } catch (e) {
    reportError(e, { action: '[useAIChatContext] proactive context failed' });
  }

  try {
    const archived = await AIDialogueService.list({ includeArchived: true });
    const personaArchived = archived.filter(d => d.personaId === personaId && d.archivedAt !== undefined && d.closingSummary !== undefined && d.closingSummary !== '');
    const recentArchived = personaArchived
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
      .slice(0, 3);

    if (recentArchived.length > 0) {
      recentArchived.forEach(d => shownIds.add(d.id));
      const prevSessionLines = recentArchived.map(d => {
        const dateStr = new Date(d.archivedAt!).toLocaleDateString('ru-RU');
        return `- ${dateStr}: ${d.closingSummary}`;
      }).join('\n');
      const previousContextBlock = `[Предыдущие сессии с этим персонажем]\n${prevSessionLines}`;
      proactiveBlock = proactiveBlock ? `${proactiveBlock}\n\n${previousContextBlock}` : previousContextBlock;
    }
  } catch (e) {
    reportError(e, { action: '[useAIChatContext] same persona dialogue memory context failed' });
  }

  try {
    const db = await getLocalDb();
    const allEvents = await db.getAll('aiDialogueEvents');
    const otherEvents = allEvents
      .filter(e => !shownIds.has(e.dialogueId))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);

    if (otherEvents.length > 0) {
      const crossSessionLines = otherEvents.map(e => {
        let dateStr = e.date;
        try {
          const dObj = new Date(e.date);
          if (!isNaN(dObj.getTime())) {
            dateStr = dObj.toLocaleDateString('ru-RU');
          }
        } catch { /* ignore */ }
        return `- ${dateStr} (${e.personaName}): ${e.summary}`;
      }).join('\n');
      const crossContextBlock = `[Выводы прошлых разговоров]\n${crossSessionLines}`;
      proactiveBlock = proactiveBlock ? `${proactiveBlock}\n\n${crossContextBlock}` : crossContextBlock;
    }
  } catch (e) {
    reportError(e, { action: '[useAIChatContext] cross dialogue memory context failed' });
  }

  try {
    const db = await getLocalDb();
    const hidden = new Set((await db.getAll('documents')).filter(isExcludedFromAI).flatMap(d => [d.id, d.uuid].filter((x): x is string => !!x)));
    const timeline = (await db.getAll('aiTimeline')).filter(t => !hidden.has(t.documentId));

    // Trends
    const { computeTrends, formatTrendsBlock } = await import('../../utils/contextTrends');
    const trends = computeTrends(timeline);
    const trendsBlock = formatTrendsBlock(trends);
    if (trendsBlock) {
      proactiveBlock = proactiveBlock ? `${proactiveBlock}\n\n${trendsBlock}` : trendsBlock;
    }

    // Contradictions
    const { detectContradictions, formatContradictions } = await import('../../utils/contradictionDetect');
    const contradictions = detectContradictions(timeline);
    if (contradictions.length > 0) {
      const contraBlock = formatContradictions(contradictions);
      proactiveBlock = proactiveBlock ? `${proactiveBlock}\n\n${contraBlock}` : contraBlock;
    }

    // Commitments
    const { AICommitmentService } = await import('../AICommitmentService');
    const openCommitments = await AICommitmentService.getOpenCommitments();
    if (openCommitments.length > 0) {
      // DLG-Q5 (Fable T-9): дата извлечения вместо даты заметки — на стенде
      // все 25 планов выглядели «сегодня», а без id заметки модель сочиняла ссылки
      // вида [#планирует-…]. Ссылка [#id · дата] — тот же формат, что у шапок заметок.
      const commitmentsLines = openCommitments.map(c => `- «${c.text}» [#${c.documentId} · ${c.date}]`).join('\n');
      const commitmentsBlock = `[Твои открытые планы / обязательства]\n${commitmentsLines}`;
      proactiveBlock = proactiveBlock ? `${proactiveBlock}\n\n${commitmentsBlock}` : commitmentsBlock;
    }

    // Narrative threads
    if (turnEmb) {
      const { AIThreadService } = await import('../AIThreadService');
      const relevantThreads = await AIThreadService.getRelevant(turnEmb, 2);
      if (relevantThreads.length > 0) {
        const threadLines = relevantThreads.map(t => `- [Сюжетная линия, активность ${t.ageDays} дней назад]: ${t.summary}`).join('\n');
        const threadBlock = `[Связанные сюжетные линии]\n${threadLines}`;
        proactiveBlock = proactiveBlock ? `${proactiveBlock}\n\n${threadBlock}` : threadBlock;
      }
    }
  } catch (e) {
    reportError(e, { action: '[useAIChatContext] proactive advanced context failed' });
  }

  return proactiveBlock;
}
