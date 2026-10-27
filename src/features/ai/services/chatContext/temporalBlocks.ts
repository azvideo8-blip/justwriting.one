import { getLocalDb } from '../../../../core/storage/localDb';
import { parseTemporalQuery, type TemporalQuery } from '../../utils/temporalQueryParser';
import { setAIStage } from '../../store/useAIStageStore';
import { AIMonthlyDigestService } from '../AIMonthlyDigestService';
import { AITimelineService } from '../AITimelineService';
import { relativeDate } from '../../../../core/utils/dateUtils';
import { reportError } from '../../../../shared/errors/reportError';
import { searchNotesMulti } from '../../utils/noteRetriever';
import { parseComparisonScopes } from './comparisonScopes';
import { formatDateYYYYMMDD } from './corpusStats';
import { isExcludedFromAI } from '../../utils/isExcludedFromAI';

export interface TemporalOutcome {
  handledByTemporal: boolean;
  skipSemantic: boolean;
  minTime: number | undefined;
  maxTime: number | undefined;
}

interface CarriedWindow {
  minTime: number;
  maxTime: number;
  from?: string | undefined;
  to?: string | undefined;
  /** PR-3: чем прошлый перечень подписывал строки — тем же и продолжение. */
  mode?: ListMode | undefined;
}

interface TemporalDeps {
  text: string;
  effectiveQuery: string;
  explicitSearch: boolean;
  /** Снимок lastSearchQueryRef.current на момент вызова. */
  lastSearchQuery: string;
  db: Awaited<ReturnType<typeof getLocalDb>>;
  /** PR-3: окно прошлого хода-перечня — только для продолжения («по одной»). */
  carriedWindow?: CarriedWindow | undefined;
}

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;

/**
 * LD-8: ход, который просит перечень за период, а не один сюжет. Слова держатся
 * одной строкой: «перечисли все мои X за октябрь» отвечал из топ-10 и утверждал,
 * что это всё, а список всех записей периода модели никто не показывал.
 */
// PR-5: падежи и живые формы. Правило срабатывает только в ходе периода
// (вызов внутри month/dateRange), поэтому «мне всё равно» перечня не тянет.
const LIST_WORDS = [
  'все', 'всё', 'всех', 'всем', 'перечисли', 'список', 'за весь',
  'каждый', 'каждой', 'каждую', 'каждого', 'каждое', 'по всем', 'по каждой',
  'пройдись по записям', 'пройтись по записям',
] as const;
const LIST_REQUEST = new RegExp(`(?:^|[^а-яё])(${LIST_WORDS.join('|')})(?![а-яё])`, 'i');
// Перечень — для окна не длиннее месяца: за квартал он раздувает контекст.
const LIST_PERIOD_MAX_DAYS = 31;
const LIST_MAX_LINES = 60;
// PR-2: перечень идёт без полных текстов — потолок по знакам, а не по записям,
// чтобы двадцать пять разборов с осознаниями влезли, а тысяча — нет.
const LIST_MAX_CHARS = 12_000;
const LIST_LINE_MAX_CHARS = 240;

/** PR-2: что человек просит у перечня: осознания, факты или обычные подписи. */
type ListMode = 'summary' | 'insights' | 'facts';
const INSIGHTS_ASK_RE = /осознан|озарен|инсайт|открыт|вывод|что\s+я\s+(?:понял|поняла|осознал|осознала)|чему\s+научил/i;
const FACTS_ASK_RE = /что\s+(?:случилось|было|произошло)|событи|факт[аыо]?(?![а-яёА-ЯЁa-zA-Z0-9])/i;

function listModeOf(text: string): ListMode {
  if (INSIGHTS_ASK_RE.test(text)) return 'insights';
  if (FACTS_ASK_RE.test(text)) return 'facts';
  return 'summary';
}

interface PeriodNote { id: string; at: number; label: string; insights: string[]; facts: string[] }

/** Видимые ИИ заметки окна, по датам; скрытые и корзина не называются вовсе. */
async function periodNotes(db: LocalDb, minTime: number, maxTime: number): Promise<PeriodNote[]> {
  const [docs, summaries] = await Promise.all([db.getAll('documents'), db.getAll('aiSummaries')]);
  const summaryById = new Map(summaries.map(s => [s.documentId, s]));
  return docs
    .filter(d => !isExcludedFromAI(d))
    .filter(d => typeof d.lastSessionAt === 'number' && d.lastSessionAt >= minTime && d.lastSessionAt <= maxTime)
    .sort((a, b) => (a.lastSessionAt ?? 0) - (b.lastSessionAt ?? 0))
    .map(d => {
      const s = summaryById.get(d.id);
      return {
        id: d.id,
        at: d.lastSessionAt ?? 0,
        label: s?.summary || d.title || '(без описания)',
        insights: s?.insights ?? [],
        facts: s?.extractedFacts ?? [],
      };
    });
}

// PR-3: продолжение хода-перечня. Только слова продолжения — новая тема окно
// прошлого хода не тянет.
const PERIOD_CONTINUATION_RE = /(?:по\s+одной|по\s+каждой|по\s+порядку|каждую|эти\s+записи|перечитай|подробнее\s+по\s+каждой)/i;
function isPeriodContinuation(text: string): boolean {
  return PERIOD_CONTINUATION_RE.test(text);
}

function replayBlock(window: CarriedWindow, notes: PeriodNote[], mode: ListMode): string {
  const label = window.from && window.to ? `${window.from}…${window.to}` : 'прошлый период';
  return inventoryBlock(label, notes, mode).replace(
    `[Все записи периода ${label}]`,
    '[Записи периода, о котором шла речь]',
  );
}

function inventoryBlock(label: string, notes: PeriodNote[], mode: ListMode): string {
  const shown: PeriodNote[] = [];
  let chars = 0;
  const textFor = (n: PeriodNote) => {
    const body = mode === 'insights'
      ? (n.insights.length > 0 ? n.insights.join('; ') : n.label)
      : mode === 'facts'
        ? (n.facts.length > 0 ? n.facts.join('; ') : n.label)
        : n.label;
    return body.slice(0, LIST_LINE_MAX_CHARS);
  };
  for (const n of notes) {
    if (shown.length >= LIST_MAX_LINES) break;
    const line = `[#${n.id} · ${formatDateYYYYMMDD(n.at)}] ${textFor(n)}`;
    if (shown.length > 0 && chars + line.length > LIST_MAX_CHARS) break;
    shown.push(n);
    chars += line.length + 1;
  }
  const rest = notes.length - shown.length;
  const lines = shown.map(n => `[#${n.id} · ${formatDateYYYYMMDD(n.at)}] ${textFor(n)}`).join('\n');
  const tail = rest > 0 ? `\n…и ещё ${rest}. Показаны ${shown.length} из ${notes.length}.` : '';
  return `\n\n[Все записи периода ${label}] ${notes.length} шт., по датам:\n${lines}${tail}\n`;
}

/** Начало местных суток для ключа 'YYYY-MM-DD'. */
function localDayStart(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getTime();
}

async function countNotesInWindow(db: LocalDb, minTime: number, maxTime: number): Promise<number> {
  const docs = await db.getAll('documents');
  return docs.filter(doc => !isExcludedFromAI(doc) && typeof doc.lastSessionAt === 'number' && doc.lastSessionAt >= minTime && doc.lastSessionAt <= maxTime).length;
}

/**
 * Сравнение периодов и хронологические запросы («за март», «с января по март»,
 * «что нового»). Возвращает либо полную замену searchContext (режим сравнения),
 либо блоки для конкатенации в исходном порядке.
 */
export async function buildTemporalBlocks(
  deps: TemporalDeps,
): Promise<{
  outcome: TemporalOutcome;
  setSearchContextTo?: string | undefined;
  appended: string;
  /** LD-8: окно периода — по нему ход считает, сколько записей дошло полным текстом.
   *  PR-3: `listed` — перечень в этом ходе был, окно запоминается для продолжения. */
  periodWindow?: { minTime: number; maxTime: number; from?: string | undefined; to?: string | undefined; listed: boolean; continued?: boolean | undefined; mode?: ListMode | undefined } | undefined;
}> {
  const { text, effectiveQuery, explicitSearch, lastSearchQuery, db, carriedWindow } = deps;
  let handledByTemporal = false;
  let skipSemantic = false;
  let minTime: number | undefined;
  let maxTime: number | undefined;

  // Блоки, которые в оригинале дописывались к searchContext через
  // `(searchContext ?? '') + ...` — собираются в порядке возникновения.
  const appends: string[] = [];
  let setSearchContextTo: string | undefined;
  let periodWindow: { minTime: number; maxTime: number; from?: string | undefined; to?: string | undefined; listed: boolean; continued?: boolean | undefined; mode?: ListMode | undefined } | undefined;

  const comparisonScopes = parseComparisonScopes(text);

  // Scope comes from THIS message only. It used to be pinned to the whole
  // dialogue from the first question, so a later question that named no
  // period was silently answered from inside the old one — invisibly making
  // every following answer worse. Follow-ups already keep their thread
  // through the sticky search below.
  const temporalQuery = parseTemporalQuery(text);
  // PR-3: «перечитай по одной» своего окна не называет. Если прошлый ход был
  // ходом-перечнем, окно берётся из него — детерминированно, по разбору реплики
  // прошлого хода, а не по словам ответа модели.
  const continuePeriod = Boolean(carriedWindow) && temporalQuery.type === 'none' && isPeriodContinuation(text);

  if (continuePeriod && carriedWindow) {
    minTime = carriedWindow.minTime;
    maxTime = carriedWindow.maxTime;
    handledByTemporal = true;
    try {
      const notes = await periodNotes(db, minTime, maxTime);
      const ownMode = listModeOf(text);
      appends.push(replayBlock(carriedWindow, notes, ownMode === 'summary' ? (carriedWindow.mode ?? 'summary') : ownMode));
      periodWindow = { ...carriedWindow, listed: false, continued: true };
    } catch (e) {
      reportError(e, { action: '[useAIChatContext] period continuation failed' });
    }
  } else if (comparisonScopes.length === 2) {
    const scopeA = comparisonScopes[0]!;
    const scopeB = comparisonScopes[1]!;

    const getScopeBlock = async (scope: TemporalQuery, label: string) => {
      let sMin: number | undefined;
      let sMax: number | undefined;
      if (scope.type === 'month') {
        const [yyyy, mm] = scope.month!.split('-');
        const year = parseInt(yyyy!, 10);
        const month = parseInt(mm!, 10) - 1;
        sMin = Date.UTC(year, month, 1);
        sMax = Date.UTC(year, month + 1, 1) - 1;
      } else if (scope.type === 'dateRange') {
        sMin = new Date(scope.from!).getTime();
        sMax = new Date(scope.to!).getTime() + 86_400_000 - 1;
      }

      let digestNarrative = '';
      if (scope.type === 'month') {
        const digest = await AIMonthlyDigestService.get(scope.month!);
        if (digest?.narrative) digestNarrative = `Сводка за месяц: ${digest.narrative}\n`;
      }

      let timelineFacts = '';
      if (scope.type === 'month') {
        const entries = await AITimelineService.getByMonth(scope.month!);
        timelineFacts = entries.flatMap(e => e.facts).join('; ');
      } else if (scope.type === 'dateRange') {
        const entries = await AITimelineService.getByDateRange(scope.from!, scope.to!);
        timelineFacts = entries.flatMap(e => e.facts).join('; ');
      }

      const searchQuery = explicitSearch ? effectiveQuery : `${lastSearchQuery}\n${text}`;
      setAIStage('search');
      const notesResult = await searchNotesMulti([searchQuery], 5, { minTime: sMin, maxTime: sMax });
      const notesText = notesResult.notes.map(n => `[#${n.documentId} · ${formatDateYYYYMMDD(n.lastSessionAt)}] Заметка "${n.title}": ${n.content.slice(0, 1000)}`).join('\n\n');

      return `=== ПЕРИОД ${label} (${scope.rawText}) ===\n` +
             (digestNarrative ? `${digestNarrative}\n` : '') +
             (timelineFacts ? `События: ${timelineFacts}\n\n` : '') +
             `Релевантные заметки:\n${notesResult.failed ? '[ОШИБКА ПОИСКА: не удалось выполнить поиск, скажите пользователю, что поиск сейчас недоступен]' : (notesText || '(нет заметок)')}\n`;
    };

    const blockA = await getScopeBlock(scopeA, 'А');
    const blockB = await getScopeBlock(scopeB, 'Б');

    setSearchContextTo = `[РЕЖИМ СРАВНЕНИЯ ПЕРИОДОВ]\nНиже приведены данные для двух сравниваемых периодов. Отвечай на вопросы пользователя, сравнивая их, но не смешивай факты между периодами.\n\n` +
                    `${blockA}\n\n${blockB}`;
    handledByTemporal = true;
    skipSemantic = true;
  } else if (temporalQuery.type === 'month') {
    const [yyyy, mm] = temporalQuery.month!.split('-');
    const year = parseInt(yyyy!, 10);
    const month = parseInt(mm!, 10) - 1;
    minTime = Date.UTC(year, month, 1);
    maxTime = Date.UTC(year, month + 1, 1) - 1;
    handledByTemporal = true;
    try {
      const entries = await AITimelineService.getByMonth(temporalQuery.month!);
      const factsStr = entries.flatMap(e => {
        const dateLabel = e.date ? `[${relativeDate(new Date(e.date).getTime())}]` : '';
        return e.facts.map(f => `${dateLabel} ${f}`);
      }).join('; ');
      const digest = await AIMonthlyDigestService.get(temporalQuery.month!);
      const narrative = digest?.narrative ? `${digest.narrative}\n\n` : '';
      const textBlock = `${narrative}В ${temporalQuery.month}: ${factsStr || 'записи отсутствуют'}. Было ${entries.length} заметок.`;
      appends.push(`\n\n[Результаты поиска по хронологии]\n${textBlock}`);
      // LD-8: окно периода отдаётся наружу (строка о полноте считается, когда
      // материал уже собран), а перечень — только на просьбу о перечне.
      const notes = await periodNotes(db, minTime, maxTime);
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      periodWindow = {
        minTime, maxTime,
        from: `${temporalQuery.month}-01`, to: `${temporalQuery.month}-${String(lastDay).padStart(2, '0')}`,
        listed: LIST_REQUEST.test(text),
        mode: listModeOf(text),
      };
      if (LIST_REQUEST.test(text)) {
        appends.push(inventoryBlock(temporalQuery.month!, notes, listModeOf(text)));
      }
    } catch (e) {
      reportError(e, { action: '[useAIChatContext] temporal query month failed' });
    }
  } else if (temporalQuery.type === 'dateRange') {
    // Границы — местные сутки: `new Date('YYYY-MM-DD')` — полночь UTC, и у
    // человека на UTC+5 «сегодня» теряло ночные записи и брало чужие вчерашние.
    minTime = localDayStart(temporalQuery.from!);
    maxTime = localDayStart(temporalQuery.to!) + 86_400_000 - 1;
    handledByTemporal = true;
    try {
      const entries = await AITimelineService.getByDateRange(temporalQuery.from!, temporalQuery.to!);
      const factsStr = entries.flatMap(e => {
        const dateLabel = e.date ? `[${relativeDate(new Date(e.date).getTime())}]` : '';
        return e.facts.map(f => `${dateLabel} ${f}`);
      }).join('; ');
      // X-4: окно по бытовому слову («вчера») называется тем же словом, а не
      // двумя ISO-датами, и пустое окно говорится вслух: иначе модель
      // додумывает содержание за день, в котором записей не было.
      const where = temporalQuery.phrase
        ? `За ${temporalQuery.phrase} (${temporalQuery.from})`
        : `В период с ${temporalQuery.from} по ${temporalQuery.to}`;
      // «Записей нет» — только когда в окне нет и заметок: заметка без разбора в
      // хронологию не попадает, а её тело в контекст приходит.
      const notesInWindow = await countNotesInWindow(db, minTime, maxTime);
      const empty = notesInWindow > 0
        ? 'событий в хронологии нет'
        : (temporalQuery.phrase ? 'записей нет' : 'записи отсутствуют');
      const textBlock = `${where}: ${factsStr || empty}. Было ${notesInWindow} заметок.`;
      appends.push(`\n\n[Результаты поиска по хронологии]\n${textBlock}`);
      // LD-8: то же для окна не длиннее месяца.
      const listed = LIST_REQUEST.test(text) && maxTime - minTime <= LIST_PERIOD_MAX_DAYS * 86_400_000;
      periodWindow = { minTime, maxTime, from: temporalQuery.from, to: temporalQuery.to, listed, mode: listModeOf(text) };
      if (listed) {
        const notes = await periodNotes(db, minTime, maxTime);
        appends.push(inventoryBlock(`${temporalQuery.from}…${temporalQuery.to}`, notes, listModeOf(text)));
      }
    } catch (e) {
      reportError(e, { action: '[useAIChatContext] temporal query dateRange failed' });
    }
  } else if (temporalQuery.type === 'recent') {
    handledByTemporal = true;
    // W-1: явная просьба поискать («поищи в заметках, что у меня было с…») не
    // гасится хронологической сводкой — сводка остаётся, но поиск идёт.
    skipSemantic = !explicitSearch;
    try {
      const digests = await AIMonthlyDigestService.getRecent(3);
      setAIStage('timeline');
      const timelines = await AITimelineService.getMostRecent(10);
      const sortedDigests = [...digests].reverse();
      const digestLines = sortedDigests.map(d => `${d.month}: ${d.narrative}`).join('\n');
      const eventLines = timelines.flatMap(e => {
        const dateLabel = e.date ? `[${relativeDate(new Date(e.date).getTime())}]` : '';
        return e.facts.map(f => `- ${dateLabel}: ${f}`);
      }).join('\n');
      const catchUpBlock = `За последние месяцы:\n${digestLines || 'Нет обзоров.'}\n\nПоследние события:\n${eventLines || 'Нет зафиксированных событий.'}`;
      appends.push(`\n\n[Хронологическая сводка]\n${catchUpBlock}`);
    } catch (e) {
      reportError(e, { action: '[useAIChatContext] temporal query recent failed' });
    }
  }

  if (minTime && maxTime) {
    try {
      const noteCountForPeriod = await countNotesInWindow(db, minTime, maxTime);
      if (noteCountForPeriod <= 2) {
        appends.push(`\n\n[СИСТЕМНОЕ ПРЕДУПРЕЖДЕНИЕ: За выбранный период найдено мало записей (${noteCountForPeriod}). Обязательно честно скажи об этом пользователю ("за этот период мало записей — ...") вместо того, чтобы придумывать или обобщать.]`);
      }
    } catch { /* ignore */ }
  }

  return {
    outcome: { handledByTemporal, skipSemantic, minTime, maxTime },
    setSearchContextTo,
    appended: appends.join(''),
    periodWindow,
  };
}
