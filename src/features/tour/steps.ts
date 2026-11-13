/** TR-2: шаги знакомства. Цели — метки `data-tour` (TR-3), без классов и текстов. */
export interface TourStep {
  id: 'write' | 'notes' | 'ai';
  route: string;
  /** Главная цель: вокруг неё кольцо и затемнение. */
  target: (mobile: boolean) => string;
  /** Вторая цель: тонкое кольцо без затемнения. */
  second?: string;
  titleKey: string;
}

const STEPS: TourStep[] = [
  { id: 'write', route: '/', target: () => '[data-tour="editor"]', second: '[data-tour="mic"]', titleKey: 'tour_write_title' },
  // На телефоне список — весь экран, показываем вкладку; на компьютере панель
  // раскрывается по наведению, поэтому показываем сам список.
  { id: 'notes', route: '/archive', target: mobile => (mobile ? '[data-tour="tab-archive"]' : '[data-tour="notes-list"]'), titleKey: 'tour_notes_title' },
  { id: 'ai', route: '/ai', target: () => '[data-tour="persona"]', titleKey: 'tour_ai_title' },
];

/** У гостя вкладки «ИИ» нет — два шага. */
export function tourSteps(isGuest: boolean): TourStep[] {
  return isGuest ? STEPS.filter(s => s.id !== 'ai') : STEPS;
}

export function tourBodyKey(id: TourStep['id'], opts: { hasMic: boolean; aiOff: boolean }): string {
  if (id === 'write') return opts.hasMic ? 'tour_write_body' : 'tour_write_body_no_mic';
  if (id === 'notes') return 'tour_notes_body';
  return opts.aiOff ? 'tour_ai_body_no_consent' : 'tour_ai_body';
}
