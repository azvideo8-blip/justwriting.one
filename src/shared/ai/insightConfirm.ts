/**
 * DI-1 (выводы из разговоров; перенос из прототипа стенда dialogue-insights-fable-2026-11):
 * согласился ли человек с выводом собеседника. Правило по тексту, без модели. Настроено на точность: сомнительное —
 * «нет» (вывод не сохраняется сам; кнопка под ответом остаётся).
 *
 * ponytail: словарь, не смысл. Потолок — иронию без маркера («гениально») и согласие
 * своими словами («вот оно что») не видит; это закрывает кнопка «Сохранить вывод».
 */
export type ReplyTail = 'verify' | 'proposal' | 'open' | 'none';
export type Confirmation = 'strong' | 'weak' | 'memo' | null;

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const B = '(?![а-яе])'; // правая граница слова: \b в JS не знает кириллицы
const W = '(?:^|[^а-яе])';

const PROPOSAL = new RegExp(`${W}(?:хочешь|хотите|давай|предлага\\S*|попробу\\S*|разбер[её]м|посмотрим|рассказать|расскажу|могу|показать|сделаем|начн[её]м|продолжим|готов[аы]?)${B}`);
const CHOICE = new RegExp(`${W}(?:что из|как(?:ая|ой|ое|ую) из|котор\\S+ из|или)${B}`);
const VERIFY = new RegExp(`${W}(?:похоже|откликается|отзывается|узна[её]шь|про тебя|так ли|верно|правда ли|близко|соглас\\S*|совпадает|попадает|подходит|звучит|как тебе|знакомо)${B}`);

/** Чем кончился ответ собеседника: от этого зависит, к чему относится голое «да». */
export function replyTail(reply: string): ReplyTail {
  const t = norm(reply.replace(/\[#[^\]]+\]/g, ''));
  if (!/\?\s*$/.test(t)) return 'none';
  const last = t.split(/(?<=[.!?…])\s+/).pop() ?? t;
  if (PROPOSAL.test(last)) return 'proposal';
  if (CHOICE.test(last)) return 'open';
  if (VERIFY.test(last)) return 'verify';
  return 'open';
}

const LEAD = /^(?:(?:слушай|ну|ой|ох|хм|а ведь|а|и|блин|вау|ого|знаешь|черт|вот)[,!\s]+)+/;
const FILL = '(?:(?:это|вот|прям|прямо|реально|действительно|очень|и|все|так) )*';
const STRONG_WORD = '(?:точно|в (?:самую )?точку|так и есть|именно(?: так)?|похоже(?: на правду| на то)?|откликается|отзывается|про меня|правда|верно|согласен|согласна|попал[аи]?)';
const STRONG = new RegExp(`^(?:(?:да|ага)[,.!]? )?${FILL}${STRONG_WORD}${B}`);
const WEAK = /^(?:да|ага)[.!…]*$/;
const MEMO = new RegExp(`${W}(?:запомни|запиши|сохрани|зафиксируй)${B}`);
// Отрицание, оговорка, сомнение, частицы при «да» («да уж», «да ладно», «ну да, конечно»).
const BLOCK = new RegExp(`${W}(?:не|нет|но|хотя|однако|только|отчасти|частично|наверно|наверное|возможно|может|вроде|кажется|почти|ладно|конечно|щас|уж|если|или|зато)${B}`);
const THUMBS = /^(?:👍|👌|💯|✅|🎯)+$/u;

/**
 * strong — согласие названо словом («точно», «в точку», «да, похоже»);
 * weak   — голое «да/ага», и ответ собеседника не кончался предложением или открытым вопросом;
 * memo   — просьба запомнить;
 * null   — не согласие или неясно.
 */
export function confirmationOf(userText: string, assistantReply: string): Confirmation {
  const raw = norm(userText);
  if (!raw) return null;
  if (THUMBS.test(raw.replace(/\s/g, ''))) return 'strong';
  if (/\?\s*$/.test(raw) && raw.split(' ').length <= 6) return null; // «да?», «точно?»
  const sentences = raw.replace(LEAD, '').split(/[.!…]+\s*|\n/).map(s => s.trim()).filter(Boolean);
  const first = sentences[0] ?? '';
  if (MEMO.test(first) && !new RegExp(`${W}не${B}`).test(first)) return 'memo';
  if (BLOCK.test(first)) return null;
  if (STRONG.test(first)) return 'strong';
  if (WEAK.test(first)) {
    // «Да. Это прям про меня…» — согласие названо во второй фразе.
    const second = sentences[1];
    if (second && !BLOCK.test(second) && STRONG.test(second)) return 'strong';
    const tail = replyTail(assistantReply);
    return tail === 'verify' || tail === 'none' ? 'weak' : null;
  }
  return null;
}

/** Вывод «кодом», без модели: абзац «Если коротко:» / «Итог:» или первая фраза с маркером предположения. */
export function codeConclusion(reply: string): string | null {
  const clean = reply.replace(/\[#[^\]]+\]/g, '').replace(/[ \t]+/g, ' ');
  const marked = /(?:Если коротко|Итог|Итого|Если одним предложением)\s*:\s*([^\n]+)/i.exec(clean)?.[1];
  const sentencesOf = (s: string) => s.split(/(?<=[.!?…])\s+/).map(x => x.trim()).filter(Boolean);
  if (marked) {
    const kept = sentencesOf(marked).filter(s => !s.endsWith('?')).slice(0, 2).join(' ');
    if (kept.length >= 20) return kept;
  }
  const hit = sentencesOf(clean).find(s => !s.endsWith('?') && /(?:предположени|гипотез|похоже,? что|получается,? что|выходит,? что|кажется,? что|как будто)/i.test(s));
  return hit && hit.length >= 20 ? hit : null;
}
