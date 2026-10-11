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
  const at = portrait.indexOf(PORTRAIT_COMMUNICATION_HEADING);
  if (at < 0) return null;
  const rest = portrait.slice(at);
  const next = rest.indexOf('\n## ', PORTRAIT_COMMUNICATION_HEADING.length);
  const section = (next < 0 ? rest : rest.slice(0, next)).replace(/^##[^\n]*\n+/, '').trim();
  return section.length > 0 ? section : null;
}
