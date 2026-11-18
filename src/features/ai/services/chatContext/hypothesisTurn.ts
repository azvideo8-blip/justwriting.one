import { getLocalDb } from '../../../../core/storage/localDb';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { cosineSimilarity } from '../../../../shared/utils/vectorMath';
import { reportError } from '../../../../shared/errors/reportError';
import { formatDateYYYYMMDD } from './corpusStats';
import { loadAnalysedIds } from '../../utils/retrieval/docSnapshot';
import { isExcludedFromAI } from '../../utils/isExcludedFromAI';
import { HYPOTHESIS_PERSONAS, HYPOTHESIS_TURN_MARK } from '../../../../shared/ai/hypothesisRule';
import { ANCHOR_PICK_MAX_CANDIDATES, ANCHOR_PICK_TEXT_MAX, type AnchorCandidate, type PickedAnchor } from '../../../../shared/ai/anchorPickPrompt';

/**
 * Ход с осторожной гипотезой (стенд ai-hypotheses-fable-2026-11, флаг `chat_hypotheses`).
 *
 * Гипотеза связывает записи разных дней. Вектор «то же самое в другой области
 * жизни» от записи про погоду не отличает (близость 0,45–0,52 у тех и у других),
 * а ответ по трём-четырём полным записям путал, что из какой. Поэтому опоры
 * выбирает отдельный служебный вызов: он читает дюжину ближайших записей и
 * возвращает дословные отрывки; код сверяет каждый с текстом записи. В ход идут
 * только выбранные записи с отмеченным отрывком — новых выводов о человеке блок не делает.
 */

export type HypothesisAsk = 'why' | 'reflect';

const B = '(?:^|[^а-яё])';
const E = '(?![а-яё])';
// Человек говорит о себе: без этого «почему небо синее» и «почему Олег молчит» — не тот ход.
const SELF_RE = new RegExp(`${B}(?:я|мне|меня|мной|мною|у меня|со мной)${E}`, 'i');
// В рассказе «я» часто опущено («опять не подошла, злюсь на себя»): там о себе
// говорят возвратное местоимение и глагол первого лица.
const SELF_TOLD_RE = new RegExp(`${B}(?:себя|себе|собой|могу|[а-яё]+(?:юсь|усь))${E}`, 'i');
const WHY_RE = new RegExp(`${B}(?:почему|отчего|из-за чего|что со мной|что (?:я |мне |тут |здесь )?не (?:вижу|замечаю|понимаю)|в ч[её]м (?:тут |здесь |на самом деле )?(?:дело|причина)|что (?:мне |меня )?(?:мешает|держит|останавливает)|что за этим стоит)${E}`, 'i');
// Просьба сделать что-то с записями или текстом — не размышление.
const REQUEST_RE = new RegExp(`${B}(?:посоветуй|подскажи|помоги|напомни|найди|покажи|составь|напиши|переведи|перечисли|выпиши|собери)${E}`, 'i');
// «Стоит, повторяется, не даётся» — слова, по которым реплика без вопроса похожа на
// рассказ о застрявшем, а не на отчёт о дне.
const STUCK_RE = new RegExp(`${B}(?:опять|снова|никак|так и не|не могу|не получается|не выходит|не понимаю|вс[её] время|каждый раз|в который раз|откладыва[а-яё]*|тяну|застрял[а-яё]*|злюсь|стыдно|страшно|устал[а-яё]*|надоело|бесит|сорвал[а-яё]*)${E}`, 'i');
const REFLECT_MIN_CHARS = 60;
// «Серая зона» кризиса: слова о нежелании жить или просыпаться, об исчезновении.
// Детектор риска (detectRisk) ловит явный риск и на таких фразах молчит, а
// протокол БЕЗОПАСНОСТЬ велит на них не уходить в дела и архив. Правило гипотезы
// стоит в промпте последним и перетянуло бы ход на себя — такой ход не для гипотезы.
// Широко намеренно: лишнее срабатывание значит только «гипотезы в этом ходе нет».
const GREY_ZONE_RE = new RegExp(`${B}(?:не хочу (?:больше |дальше |так |вообще )*(?:жить|просыпаться|быть)|не хочется (?:больше |дальше )*(?:жить|просыпаться)|устал[а-яё]* жить|незачем жить|не жить|исчезнуть|умереть|умру|смерт[а-яё]*|покончить|наглота[а-яё]*|повеситься|повеш[а-яё]*сь|суицид[а-яё]*|самоубий[а-яё]*|(?:лучше|легче|проще)[^.?!]{0,30}без меня|меня (?:вообще |совсем )?не (?:было|станет))${E}`, 'i');

/**
 * Годится ли реплика для хода с гипотезой: человек сам спрашивает «почему»
 * о себе либо рассказывает о том, что у него стоит или повторяется. Короткий
 * бытовой вопрос, просьба и вопрос о факте сюда не попадают.
 */
export function hypothesisAskOf(text: string, personaId: string): HypothesisAsk | null {
  if (!HYPOTHESIS_PERSONAS.includes(personaId)) return null;
  if (REQUEST_RE.test(text) || GREY_ZONE_RE.test(text)) return null;
  const self = SELF_RE.test(text);
  if (self && WHY_RE.test(text)) return 'why';
  if (text.includes('?') || !(self || SELF_TOLD_RE.test(text))) return null;
  return text.trim().length >= REFLECT_MIN_CHARS && STUCK_RE.test(text) ? 'reflect' : null;
}

/** Числа подбора. Объект, а не константы: стенд меняет их на время замера (H_HYPO_TUNE). */
export const HYPOTHESIS_MATERIAL = {
  /** Порог близости к реплике для записи-кандидата. Ниже лёгкого поиска (0,5): сцена из другой области жизни на реплику похожа слабо. */
  candidateFloor: 0.35,
  /** Меньше кандидатов — записей мало, связывать нечего (стенд: человек с четырьмя записями). */
  minCandidates: 6,
  /**
   * Две опоры ближе этого друг к другу — об одном и том же предмете: вторая не
   * берётся. Замер на стенде (bge-m3, кусок к куску): записи мотива из одной
   * области жизни выше 0,62 в 85 % пар, из разных областей — в 18 %.
   */
  sameSubject: 0.62,
  /** Сколько опор идёт в ход. */
  maxAnchors: 4,
};

export interface HypothesisNote {
  id: string;
  at: number;
  title: string;
  chunks: string[];
  vectors: number[][];
}

export interface HypothesisBlock {
  block: string;
  ids: string[];
  /** Даты показанных записей (YYYY-MM-DD). */
  dates: string[];
}

/** Служебный вызов «найди опоры»: сверенные отрывки либо пустой список. */
export type AnchorPicker = (message: string, candidates: AnchorCandidate[]) => Promise<PickedAnchor[]>;

/** Записи-кандидаты для шага «найди опоры»: ближайшие к реплике, текст с начала записи. */
export function hypothesisCandidates(turnEmb: number[], notes: HypothesisNote[]): AnchorCandidate[] {
  return notes.filter(n => n.chunks.length > 0)
    .map(n => ({ n, score: Math.max(...n.vectors.map(v => cosineSimilarity(turnEmb, v))) }))
    .filter(c => c.score >= HYPOTHESIS_MATERIAL.candidateFloor)
    .sort((a, b) => b.score - a.score)
    .slice(0, ANCHOR_PICK_MAX_CANDIDATES)
    .map(c => ({ documentId: c.n.id, date: formatDateYYYYMMDD(c.n.at), title: c.n.title, text: c.n.chunks.join('\n').slice(0, ANCHOR_PICK_TEXT_MAX) }));
}

/**
 * Опоры должны быть о разном: три записи про один и тот же предмет показывают,
 * что стоит, а не почему. Порядок — как выбрал служебный вызов (он начинает с
 * самых далёких по теме).
 */
export function diverseAnchors(picked: PickedAnchor[], notes: HypothesisNote[]): PickedAnchor[] {
  const byId = new Map(notes.map(n => [n.id, n]));
  const kept: { a: PickedAnchor; n: HypothesisNote }[] = [];
  for (const a of picked) {
    const n = byId.get(a.documentId);
    if (!n || kept.length >= HYPOTHESIS_MATERIAL.maxAnchors) continue;
    const close = kept.some(k => k.n.vectors.some(v => n.vectors.some(w => cosineSimilarity(v, w) >= HYPOTHESIS_MATERIAL.sameSubject)));
    if (!close) kept.push({ a, n });
  }
  return kept.map(k => k.a);
}

/** Блок хода из сверенных опор, от ранней к поздней. null — опор меньше двух. */
export function buildAnchorBlock(candidates: AnchorCandidate[], picked: PickedAnchor[]): HypothesisBlock | null {
  const byId = new Map(candidates.map(c => [c.documentId, c]));
  const shown = picked.flatMap(a => { const c = byId.get(a.documentId); return c ? [{ c, quote: a.quote }] : []; })
    .sort((a, b) => a.c.date.localeCompare(b.c.date));
  if (new Set(shown.map(x => x.c.date)).size < 2) return null;
  // Запись идёт целиком, с отмеченным отрывком: по одному отрывку модель путала,
  // кто говорит и о чём речь (стенд: 13 искажений на 49 ответов).
  const lines = shown.map((x, i) => `[#${x.c.documentId} · ${x.c.date}]\nЗаметка ${i + 1}: "${x.c.title || 'Без названия'}"\n${x.c.text}\nГлавное здесь — дословно: ${x.quote.replace(/\s+/g, ' ')}`);
  return {
    block: `${HYPOTHESIS_TURN_MARK}\n\n[Опоры — ${shown.length} записей разных дней, от ранней к поздней; в каждой отмечен главный отрывок.]\n${lines.join('\n\n')}`,
    ids: shown.map(x => x.c.documentId),
    dates: [...new Set(shown.map(x => x.c.date))],
  };
}

/**
 * Обвязка над IndexedDB. null — флаг выключен или не прочитался, кандидатов или
 * опор меньше двух, вызов или сборка упали: во всех случаях ход идёт прежним путём.
 */
export async function buildHypothesisBlock(deps: {
  text: string;
  turnEmb: number[] | undefined;
  db: Awaited<ReturnType<typeof getLocalDb>>;
  minTime: number | undefined;
  maxTime: number | undefined;
  injectedDocumentIds: string[];
  allEmbeddings?: Awaited<ReturnType<typeof AIEmbeddingService.getAll>> | undefined;
  /** Флаг `chat_hypotheses`. Спрашивается, только когда ход годится; сбой чтения — false. */
  enabled: () => Promise<boolean>;
  pick: AnchorPicker;
}): Promise<HypothesisBlock | null> {
  const { text, turnEmb, db, minTime, maxTime, injectedDocumentIds, allEmbeddings, enabled, pick } = deps;
  if (!turnEmb) return null;
  try {
    if (!(await enabled().catch(() => false))) return null;
    const [allEmb, docs, analysed] = await Promise.all([
      allEmbeddings ?? AIEmbeddingService.getAll(),
      db.getAll('documents'),
      loadAnalysedIds(), // TR-9: в разговор — только разобранные
    ]);
    const embById = new Map(allEmb.map(e => [e.documentId, e]));
    const notes: HypothesisNote[] = [];
    for (const d of docs) {
      if (isExcludedFromAI(d) || !analysed.has(d.id)) continue;
      const ts = d.lastSessionAt || d.firstSessionAt;
      if (!ts || (minTime !== undefined && ts < minTime) || (maxTime !== undefined && ts > maxTime)) continue;
      const e = embById.get(d.id);
      if (!e?.chunkTexts?.length) continue;
      notes.push({ id: d.id, at: ts, title: d.title, chunks: e.chunkTexts, vectors: e.vectors });
    }
    const candidates = hypothesisCandidates(turnEmb, notes);
    if (candidates.length < HYPOTHESIS_MATERIAL.minCandidates) return null;
    const result = buildAnchorBlock(candidates, diverseAnchors(await pick(text, candidates), notes));
    if (result) injectedDocumentIds.push(...result.ids);
    return result;
  } catch (e) {
    reportError(e, { action: '[useAIChatContext] hypothesis material failed' });
    return null;
  }
}
