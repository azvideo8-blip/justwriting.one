// Visual identity for chat personas — colour, serif monogram and a short role line.
// Mirrors the "Собеседник" design language (ai-chat mockup). Preset personas get a
// fixed palette; custom personas derive a monogram from their name and reuse the brand soft.

import { useLanguage } from '../../../shared/i18n';

export interface PersonaVisual {
  color: string;
  mono: string;
  role: { ru: string; en: string };
}

const PRESET_VISUALS: Record<string, PersonaVisual> = {
  group_psychology: { color: '#A583E8', mono: 'Гп', role: { ru: 'многогранная перспектива', en: 'a many-voiced view' } },
  cbt:              { color: '#7BA9F0', mono: 'К',  role: { ru: 'когнитивно-поведенческий', en: 'cognitive-behavioural' } },
  editor:           { color: '#F0A879', mono: 'Р',  role: { ru: 'структура и ясность', en: 'structure and clarity' } },
  coach:            { color: '#7DD3A8', mono: 'Кч', role: { ru: 'действие и цели', en: 'action and goals' } },
  journalist:       { color: '#C896F0', mono: 'Ж',  role: { ru: 'вопросы и факты', en: 'questions and facts' } },
};

const CUSTOM_COLOR = '#A583E8';

// First grapheme of the name, upper-cased — a tasteful fallback monogram for custom personas.
function deriveMono(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '·';
  return [...trimmed][0]?.toUpperCase() ?? '·';
}

export function personaVisual(id: string, name: string): PersonaVisual {
  return PRESET_VISUALS[id] ?? { color: CUSTOM_COLOR, mono: deriveMono(name), role: { ru: '', en: '' } };
}

export function usePersonaRole(id: string, name: string): string {
  const { language } = useLanguage();
  const v = personaVisual(id, name);
  return language === 'en' ? v.role.en : v.role.ru;
}
