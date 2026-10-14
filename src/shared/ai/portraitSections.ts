// DR-11: в строгом ходе (разбор приложенной заметки) портрет приезжает целиком,
// и модель строила на нём целый тред «центральная тема ваших заметок» — то есть
// выносила про человека суждение по темам прошлых записей, а не по тексту этого
// хода (кейс 8, пункт 2.2 раньше). Правило «не приписывай профилею этой заметке»
// в промпте есть, и LD-3 показало: усиливать его словами нельзя (утечка
// деталей 1/20 → 6/20). Здесь рычаг кодовый: в строгом ходе остаётся только
// часть портрета о том, КАК говорить.
//
// Портрет собирается в AIProfileService.generate(): пять разделов генерируются
// отдельно (profileThemes, profileEmotionalPatterns, profileStrengths,
// profileGrowth, profileCommunication), а в `aiPortrait.portrait` хранится уже
// склеенный markdown с заголовками `## …`. Поэтому отсечение механическое:
// заголовок стабильный, генерацию трогать не нужно.
export const PORTRAIT_COMMUNICATION_HEADING = '## Стиль общения';

/** Часть портрета о тоне, обращении, роде и длине; null — раздела в тексте нет. */
export function communicationSection(portrait: string | null | undefined): string | null {
  if (!portrait) return null;
  // Заголовок раздела — строка ровно `## Стиль общения`, а не подзаголовок
  // `### Стиль общения…` внутри другого раздела (ревью 0.9.39).
  const m = /(^|\n)## Стиль общения[^\n]*/.exec(portrait);
  if (!m) return null;
  const at = m.index + m[1]!.length;
  const rest = portrait.slice(at);
  const next = rest.indexOf('\n## ', PORTRAIT_COMMUNICATION_HEADING.length);
  const section = (next < 0 ? rest : rest.slice(0, next)).replace(/^##[^\n]*\n+/, '').trim();
  return section.length > 0 ? section : null;
}

// PX-1 (кейсы 9.9 и 9.8 ревью 13.10): DR-11 отрезал раздел «Стиль общения», но
// генератор пишет его не тремя предложениями, а на несколько экранов — с
// подзаголовками, и внутри списка ключевых тем (люди, детские эпизоды, конфликты).
// Темы поэтому доезжают до строгого хода и модель выдаёт их за вывод из этой
// заметки: «привычная для тебя форма», «то, что ты описывал раньше», «в отличие от
// июня…». Второе: `communicationSection(p) ?? p` при старом формате портрета
// (раздела нет) отправлял в строгий ход ВЕСЬ портрет.
//
// Рычаг кодовый, новых слов модели не добавляется — из строгого хода уходит
// лишнее. Раздел с подзаголовками режется по заголовкам блоков: остаются только
// те, что про то, КАК говорить. Простыня без подзаголовков — старый формат, в ней
// те же темы, поэтому null.
// «тон» — только словом целиком (тон, тона, тоне…): «Тонкие места» — блок о
// людях и событиях, не о манере (ревью 0.9.39).
const HOW_TO_TALK = [/(?<![а-яё])предпочт/, /(?<![а-яё])сложност/, /(?<![а-яё])тон(?:а|е|у|ом|ы)?(?![а-яё])/, /(?<![а-яё])обращ/, /как говорить/, /как общаться/, /чего избегать/];
// Даже из блоков «как говорить» в строгий ход едет не больше этого: длиннее —
// значит, в блок затёк список тем, которого разметка не выдала (ревью 0.9.39:
// «Ключевые темы:» строкой с двоеточием тянула за собой весь хвост раздела).
const KEPT_MAX = 1200;
// Задуманная форма раздела — 3–5 предложений без подзаголовков.
const PLAIN_SECTION_MAX = 800;
// Короткая строка без точки, над которой абзац, — подзаголовок в том виде, как
// его пишет модель (жирная строка или просто строка-заголовок).
const HEADING_MAX_CHARS = 60;
const PARAGRAPH_MIN_CHARS = 40;

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Заголовок блока в том виде, как его пишет генератор; null — строка не заголовок. */
function headingAt(lines: string[], i: number): string | null {
  const line = (lines[i] ?? '').trim();
  if (!line) return null;
  const hash = /^#{3,6}\s+(.+?)\s*#*$/.exec(line);
  if (hash) return hash[1] ?? null;
  // жирная строка, в том числе пунктом списка: `**Темы**`, `- **Темы**:`
  const bold = /^(?:[-*•]\s+)?\*\*([^*]+)\*\*[:.]?$/.exec(line);
  if (bold) return bold[1] ?? null;
  if (line.length > HEADING_MAX_CHARS) return null;
  // короткая строка с двоеточием на конце — заголовок перед списком или абзацем
  // («Ключевые темы:»), если это не пункт списка
  if (/:$/.test(line) && !/^[-*•—]|\d+[.)]\s/.test(line)) return line.slice(0, -1);
  // строка-заголовок без разметки: короткая, не оканчивается на знак конца
  // предложения, не пункт списка, а под ней — абзац
  if (/[.!?…;]$/.test(line)) return null;
  if (/^[-*•—]|\d+[.)]\s/.test(line)) return null;
  const next = lines.slice(i + 1).find(l => l.trim() !== '');
  if (!next || next.trim().length < PARAGRAPH_MIN_CHARS || next.startsWith('#')) return null;
  return line;
}

/** Только блоки раздела про то, как говорить; preamble и остальные блоки — вне. */
function howToTalkBlocks(section: string): string {
  const lines = section.split('\n');
  const heads: Array<{ at: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const title = headingAt(lines, i);
    if (title !== null) heads.push({ at: i, title: norm(title) });
  }
  const kept: string[] = [];
  heads.forEach((h, n) => {
    if (!HOW_TO_TALK.some(re => re.test(h.title))) return;
    const end = heads[n + 1]?.at ?? lines.length;
    kept.push(lines.slice(h.at, end).join('\n').trim());
  });
  return kept.join('\n\n').trim();
}

/**
 * Что от портрета остаётся в строгом ходе разбора приложенной заметки.
 * null — портрет в ход не едет (ни раздела, ни только-про-стиль части нет).
 */
export function strictTurnPortrait(portrait: string | null | undefined): string | null {
  const section = communicationSection(portrait);
  // Раздела нет (старый формат) — целый портрет в строгий ход не слётся (9.8).
  if (!section) return null;
  const lines = section.split('\n');
  const hasSubHeading = lines.some((_, i) => headingAt(lines, i) !== null);
  if (!hasSubHeading) return section.length <= PLAIN_SECTION_MAX ? section : null;
  const kept = howToTalkBlocks(section);
  return kept.length > 0 && kept.length <= KEPT_MAX ? kept : null;
}
