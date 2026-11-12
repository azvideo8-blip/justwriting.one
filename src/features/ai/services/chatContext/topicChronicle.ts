import { getLocalDb } from '../../../../core/storage/localDb';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { cosineSimilarity } from '../../../../shared/utils/vectorMath';
import { reportError } from '../../../../shared/errors/reportError';
import { formatDateYYYYMMDD } from './corpusStats';
import { isExcludedFromAI } from '../../utils/isExcludedFromAI';
import { ARCHIVE_TURN_MARK } from '../../../../shared/ai/archiveAnswerRule';

/**
 * Хроника по вопросу (стенд ai-memory-base-fable-2026-11).
 *
 * Вопрос о прошлом («когда впервые», «как менялось», «что я решила», «всё про X»,
 * да и просто «сколько весил пёс в июне») раньше получал три куска лёгкого
 * поиска либо десять заметок полного — по близости, вперемешку по датам. На
 * стенде нужная заметка стояла в первой тройке по вектору у 37 % вопросов, в
 * первых сорока — у 83 %: база ответ знала, но в ход он не доезжал.
 *
 * Здесь нет ни одного вызова модели: берётся вектор реплики, уже посчитанный
 * ходом, и векторы заметок из IndexedDB. Из заметок в ход идёт только дословный
 * текст (кусок или отрывок) — новых выводов о человеке блок не делает.
 *
 * Хроника включается не на любой вопрос (решение владельца 10.11): только на
 * вопрос о своих записях или прошлом — явные формулировки ниже, названный
 * человек или период, либо вопрос с глаголом прошедшего времени. Прочие
 * реплики («что мне делать с этой тревогой?») идут как в 0.11.8 — три куска
 * лёгкого поиска.
 */

export type ChronicleMode = 'first' | 'evolution' | 'decision' | 'all' | 'fact';

const B = '(?:^|[^а-яёa-z0-9])';
const MODE_PATTERNS: Array<[Exclude<ChronicleMode, 'fact'>, RegExp]> = [
  ['first', new RegExp(`${B}(впервые|в первый раз|первый раз|с каких пор|с какого времени|когда (я |у меня )?(начал|появил|стал))`, 'i')],
  ['evolution', new RegExp(`${B}как[^.?!]{0,60}(менял|изменил|изменял|развивал|складывал)|${B}(динамик|эволюци)`, 'i')],
  ['decision', new RegExp(`${B}(что|как|о ч[её]м|к какому сроку|какое правило)[^.?!]{0,40}(решил|пообещал|обещал|договорил|постановил|завел|завёл|определи)|${B}чем[^.?!]{0,20}(закончил|кончил)`, 'i')],
  ['all', new RegExp(`${B}(вс[её]|все)\\s+(что\\s+)?(про|о|об|записи|заметки|упоминания)(?![а-яё])|${B}что[^.?!]{0,20}(писал|записан|записыв)[^.?!]{0,12}(про|о|об)(?![а-яё])|${B}собери\\s+вс[её]`, 'i')],
];
// Вопрос как таковой: знак вопроса либо вопросительное слово в начале реплики.
const QUESTION_RE = /\?\s*$|^\s*(что|когда|как|какой|какая|какое|какие|сколько|где|кто|чем|кому|о ч[её]м|к какому|с кем|зачем|почему)(?![а-яё])/i;
// Глагол прошедшего времени: вопрос о прошлом («сколько весил пёс», «какой
// торт я везла»). Советы и настоящее время («что мне делать», «что говорит
// брат») сюда не попадают — для них нужен названный человек или период.
// Глагол на -л/-ла/-ли — прошедшее время. Ловит и существительные и союзы («цели»,
// «дела», «если»), поэтому советы отсекаются отдельно, по форме вопроса.
// 0.11.12: требование местоимения рядом (ревью 0.11.10) отрезало вопросы о фактах
// без подлежащего («сколько весил пёс, когда его взвешивали…») — стенд −5 п.
const PAST_VERB_RE = /(?:^|[^а-яё])[а-яё]+л(?:а|о|и)?(?![а-яё])/i;
// Совет и «как быть»: «что/как (мне) <неопределённая форма>», «посоветуй/подскажи/помоги».
const ADVICE_RE = /(?:^|[^а-яё])(?:(?:что|как)\s+(?:же\s+)?(?:мне\s+|нам\s+)?[а-яё]+(?:ть|ться|ти)(?![а-яё])|посоветуй|подскажи|помоги)/i;

/** Режим хроники для реплики; null — реплика не вопрос о записях или прошлом.
 *  `signals` — названный человек (имя или роль) и названный период хода. */
export function chronicleModeOf(text: string, signals?: { person?: boolean; period?: boolean }): ChronicleMode | null {
  for (const [mode, re] of MODE_PATTERNS) if (re.test(text)) return mode;
  if (!QUESTION_RE.test(text)) return null;
  return signals?.person || signals?.period || (PAST_VERB_RE.test(text) && !ADVICE_RE.test(text)) ? 'fact' : null;
}

export interface ChronicleNote {
  id: string;
  at: number;
  title: string;
  chunks: string[];
  vectors: number[][];
}

/** Порог близости кандидата. Ниже лёгкого поиска (0.5): строка хроники короткая,
 *  а эталонные заметки стенда имели медиану косинуса 0.56 и 10-й перцентиль 0.38. */
export const CHRONICLE_FLOOR = 0.4;
/** Сколько заметок идёт полным куском (вместо трёх у лёгкого поиска). */
export const FOCUS_NOTES = 6;
export const FOCUS_NOTES_FACT = 8;
export const CHRONICLE_MAX_LINES = 25;
const EXCERPT_MAX = 240;

/**
 * Вторая версия подачи (флаг `answer_chronicle_v2`, стенд ai-answer-chronicle-fable-2026-11).
 * Скольким лучшим заметкам, нарезанным на несколько кусков, дать второй по
 * близости кусок. Замер ×52 вопроса: 2 заметки — «факт в контексте» 79 → 86 %
 * при росте контекста на 6,5 %; 3 заметки дают те же 86 % и +9 % знаков.
 * Объект, а не константа: стенд меняет число на время замера (H_V2_TUNE).
 */
export const CHRONICLE_V2 = { secondChunkNotes: 2 };

const STOP = new Set(['когда', 'впервые', 'первый', 'менялось', 'менялись', 'менялась', 'менялся', 'записи', 'заметки', 'писала', 'писал', 'решила', 'решил', 'моего', 'моему', 'своего', 'этого', 'потом', 'тогда', 'было', 'была', 'были', 'чтобы', 'какой', 'какая', 'какие', 'сколько', 'меня', 'себе']);

/** Основы значимых слов реплики: по ним выбирается дословный отрывок строки. */
export function queryStems(text: string): string[] {
  const words = text.toLowerCase().replace(/ё/g, 'е').match(/[а-яa-z0-9]{4,}/g) ?? [];
  return [...new Set(words.filter(w => !STOP.has(w)).map(w => w.slice(0, Math.max(4, w.length - 2))))];
}

/** Дословный отрывок куска: предложение с наибольшим числом слов вопроса и следующие за ним. */
export function pickExcerpt(chunk: string, stems: string[]): string {
  const sentences = chunk.split(/(?<=[.!?…])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  if (sentences.length === 0) return '';
  let best = 0;
  let bestHits = 0;
  sentences.forEach((s, i) => {
    const l = s.toLowerCase().replace(/ё/g, 'е');
    const hits = stems.filter(st => l.includes(st)).length;
    if (hits > bestHits) { bestHits = hits; best = i; }
  });
  let out = sentences[best] ?? '';
  for (let i = best + 1; i < sentences.length && out.length + 1 + (sentences[i]?.length ?? 0) <= EXCERPT_MAX; i++) out += ` ${sentences[i]}`;
  return out.length > EXCERPT_MAX ? `${out.slice(0, EXCERPT_MAX)}…` : out;
}

export interface ChronicleResult {
  block: string;
  ids: string[];
  /** Даты записей хроники (YYYY-MM-DD) — законные ответы на «когда впервые». */
  dates: string[];
}

/**
 * Чистая сборка блока. `forcedIds` — заметки, которые обязаны войти независимо
 * от близости (совпадение по имени человека); `skipFocusIds` — уже показанные
 * полным текстом (полный поиск), их кусок второй раз не кладётся.
 */
export function buildTopicChronicle(input: {
  text: string;
  mode: ChronicleMode;
  turnEmb: number[];
  notes: ChronicleNote[];
  corpus: { total: number; from: string; to: string };
  forcedIds?: Set<string> | undefined;
  skipFocusIds?: Set<string> | undefined;
  withFocus: boolean;
  /** Вторая версия подачи; без неё блок побайтно как в 0.11.10. */
  v2?: boolean | undefined;
}): ChronicleResult | null {
  const { text, mode, turnEmb, notes, corpus, forcedIds, skipFocusIds, withFocus, v2 } = input;
  const stems = queryStems(text);
  const scored = notes.map(n => {
    let score = -1;
    let chunk = 0;
    // Второй по близости кусок той же заметки (-1 — заметка из одного куска).
    let second = -1;
    let secondScore = -1;
    n.vectors.forEach((v, i) => {
      const s = cosineSimilarity(turnEmb, v);
      if (s > score) { second = chunk; secondScore = score; score = s; chunk = i; }
      else if (s > secondScore) { second = i; secondScore = s; }
    });
    if (secondScore < 0) second = -1;
    return { n, score, chunk, second };
  }).filter(c => c.n.chunks.length > 0)
    .sort((a, b) => b.score - a.score);

  let shownAll = 0;
  let timeline: typeof scored = [];
  if (mode !== 'fact') {
    const forced = scored.filter(c => forcedIds?.has(c.n.id));
    const byScore = scored.filter(c => c.score >= CHRONICLE_FLOOR && !forcedIds?.has(c.n.id));
    shownAll = forced.length + byScore.length;
    timeline = [...forced, ...byScore].slice(0, CHRONICLE_MAX_LINES).sort((a, b) => a.n.at - b.n.at);
  }

  const focusCount = mode === 'fact' ? FOCUS_NOTES_FACT : FOCUS_NOTES;
  let focus: typeof scored = [];
  if (withFocus && mode === 'evolution' && timeline.length > focusCount) {
    // «Как менялось» — это этапы: полным куском идёт лучшая запись каждого отрезка
    // ленты, а не шесть самых похожих (они обычно из одного месяца).
    for (let i = 0; i < focusCount; i++) {
      const bucket = timeline.slice(Math.floor(i * timeline.length / focusCount), Math.floor((i + 1) * timeline.length / focusCount))
        .filter(c => !skipFocusIds?.has(c.n.id));
      const best = bucket.sort((a, b) => b.score - a.score)[0];
      if (best) focus.push(best);
    }
  } else if (withFocus) {
    focus = scored.filter(c => c.score >= CHRONICLE_FLOOR && !skipFocusIds?.has(c.n.id)).slice(0, focusCount);
  }
  const parts: string[] = [];
  // v2: длинная заметка отдаёт не один кусок, а два лучших. На стенде в каждом
  // третьем случае «заметка в контексте, а нужной фразы в куске нет» фраза стояла
  // во втором по близости куске той же заметки.
  const twoChunks = new Set(v2
    ? [...focus].sort((a, b) => b.score - a.score).filter(c => c.second >= 0).slice(0, CHRONICLE_V2.secondChunkNotes).map(c => c.n.id)
    : []);
  const shownChunks = new Map<string, Set<number>>();
  const focusText = (c: typeof scored[number]): string => {
    const best = c.n.chunks[c.chunk] ?? '';
    if (!twoChunks.has(c.n.id)) { shownChunks.set(c.n.id, new Set([c.chunk])); return best; }
    shownChunks.set(c.n.id, new Set([c.chunk, c.second]));
    const [a, b] = c.chunk < c.second ? [c.chunk, c.second] : [c.second, c.chunk];
    // Куски идут в порядке заметки; между несоседними — знак пропуска.
    return `${c.n.chunks[a] ?? ''}\n${b - a > 1 ? '[…]\n' : ''}${c.n.chunks[b] ?? ''}`;
  };
  if (focus.length > 0) {
    // Этапы — по датам; иначе лучший последним: ближе к вопросу (как в полном поиске, OPT-7).
    const ordered = mode === 'evolution' ? [...focus].sort((a, b) => a.n.at - b.n.at) : [...focus].reverse();
    const lines = ordered.map((c, i) =>
      `[#${c.n.id} · ${formatDateYYYYMMDD(c.n.at)}]\nЗаметка ${i + 1}: "${c.n.title || 'Без названия'}"\n${v2 ? focusText(c) : (c.n.chunks[c.chunk] ?? '')}`);
    parts.push(`[Возможно релевантные заметки]\n${lines.join('\n\n')}`);
  }

  if (mode !== 'fact') {
    if (timeline.length > 0) {
      const lines = timeline.map(c => {
        // У заметки, найденной по имени, лучший по вектору кусок может быть не про человека —
        // отрывок ищется по словам вопроса во всех кусках.
        let source = forcedIds?.has(c.n.id) ? c.n.chunks.join('\n') : (c.n.chunks[c.chunk] ?? '');
        // v2: показанный полным куском текст в строке ленты не повторяется —
        // отрывок берётся из остальных кусков заметки.
        const shown = v2 ? shownChunks.get(c.n.id) : undefined;
        if (shown) {
          const rest = c.n.chunks.filter((_, i) => !shown.has(i));
          // Заметка показана выше целиком — строка держит только место в ленте по датам.
          if (rest.length === 0) return `[#${c.n.id} · ${formatDateYYYYMMDD(c.n.at)}] «${c.n.title || 'Без названия'}»: текст выше.`;
          source = rest.join('\n');
        }
        return `[#${c.n.id} · ${formatDateYYYYMMDD(c.n.at)}] «${c.n.title || 'Без названия'}»: дословно: ${pickExcerpt(source, stems)}`;
      });
      if (v2) {
        // Правила ответа ушли из шапки в системный промпт (ARCHIVE_ANSWER_RULE):
        // внутри ограды данных модель инструкции выполнять не обязана.
        parts.push(
          `[Хроника по вопросу — ${timeline.length} записей по датам, от ранней к поздней. `
          + `Подобраны поиском из ${corpus.total} заметок (${corpus.from} — ${corpus.to})`
          + (shownAll > timeline.length ? `, ещё ${shownAll - timeline.length} подходящих не поместились` : '')
          + `; это могут быть не все записи на тему — не называй список полным. `
          + `После «дословно:» — отрывок из самой заметки.]\n${lines.join('\n')}`,
        );
      } else parts.push(
        `[Хроника по вопросу — ${timeline.length} записей по датам, от ранней к поздней. `
        + `Подобраны поиском из ${corpus.total} заметок (${corpus.from} — ${corpus.to})`
        + (shownAll > timeline.length ? `, ещё ${shownAll - timeline.length} подходящих не поместились` : '')
        + `; это могут быть не все записи на тему — не называй список полным. `
        + `После «дословно:» — отрывок из самой заметки. `
        + `Дату называй по шапке строки. На «когда впервые» отвечай самой ранней записью, где это действительно есть; `
        + `на «как менялось» иди по датам.]\n${lines.join('\n')}`,
      );
    }
  }
  if (parts.length === 0) return null;
  if (v2) parts.unshift(ARCHIVE_TURN_MARK);
  const shown = [...focus, ...timeline];
  return {
    block: parts.join('\n\n'),
    ids: [...new Set(shown.map(c => c.n.id))],
    dates: [...new Set(timeline.map(c => formatDateYYYYMMDD(c.n.at)))],
  };
}

/** Обвязка над IndexedDB. null — блок не нужен или не собрался (тогда ход идёт прежним путём). */
export async function buildTopicChronicleBlock(deps: {
  text: string;
  turnEmb: number[] | undefined;
  db: Awaited<ReturnType<typeof getLocalDb>>;
  minTime: number | undefined;
  maxTime: number | undefined;
  /** Полный поиск уже положил свои заметки: их куски не дублируются, остаётся только хроника. */
  performedFullSearch: boolean;
  injectedDocumentIds: string[];
  /** Индекс векторов, если ход его уже поднял (X-5: сверка ключей стора — одна на ход). */
  allEmbeddings?: Awaited<ReturnType<typeof AIEmbeddingService.getAll>> | undefined;
  /** Имена людей вопроса как регулярные выражения по падежным формам (в т. ч. имя по роли). */
  nameRegexes?: RegExp[] | undefined;
  /** Флаг `answer_chronicle_v2`. Спрашивается только когда хроника нужна; сбой чтения — false. */
  v2Enabled?: (() => Promise<boolean>) | undefined;
}): Promise<ChronicleResult | null> {
  const { text, turnEmb, db, minTime, maxTime, performedFullSearch, injectedDocumentIds, nameRegexes, allEmbeddings, v2Enabled } = deps;
  const mode = chronicleModeOf(text, {
    person: (nameRegexes?.length ?? 0) > 0,
    period: minTime !== undefined || maxTime !== undefined,
  });
  if (!mode || !turnEmb) return null;
  if (mode === 'fact' && performedFullSearch) return null;
  try {
    const [allEmb, docs, v2] = await Promise.all([
      allEmbeddings ?? AIEmbeddingService.getAll(),
      db.getAll('documents'),
      v2Enabled ? v2Enabled().catch(() => false) : false,
    ]);
    const live = docs.filter(d => {
      if (isExcludedFromAI(d)) return false;
      const ts = d.lastSessionAt || d.firstSessionAt;
      if (!ts) return false;
      if (minTime !== undefined && ts < minTime) return false;
      if (maxTime !== undefined && ts > maxTime) return false;
      return true;
    });
    const embById = new Map(allEmb.map(e => [e.documentId, e]));
    const persons = nameRegexes ?? [];
    const notes: ChronicleNote[] = [];
    const forcedIds = new Set<string>();
    for (const d of live) {
      const e = embById.get(d.id);
      if (!e || !e.chunkTexts || e.chunkTexts.length === 0) continue;
      notes.push({ id: d.id, at: (d.lastSessionAt || d.firstSessionAt) as number, title: d.title, chunks: e.chunkTexts, vectors: e.vectors });
      if (persons.some(re => e.chunkTexts?.some(c => re.test(c)))) forcedIds.add(d.id);
    }
    const dates = live.map(d => (d.lastSessionAt || d.firstSessionAt) as number).sort((a, b) => a - b);
    const result = buildTopicChronicle({
      text, mode, turnEmb, notes,
      corpus: { total: live.length, from: formatDateYYYYMMDD(dates[0]), to: formatDateYYYYMMDD(dates[dates.length - 1]) },
      forcedIds,
      skipFocusIds: new Set(injectedDocumentIds),
      withFocus: !performedFullSearch,
      v2,
    });
    if (result) injectedDocumentIds.push(...result.ids);
    return result;
  } catch (e) {
    reportError(e, { action: '[useAIChatContext] topic chronicle failed' });
    return null;
  }
}
