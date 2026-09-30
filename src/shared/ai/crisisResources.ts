// Единственный список телефонов помощи для России. Из него строятся строка в
// системном промпте (SAFETY_GUIDE), кризисный блок контекста чата и — через
// тест crisisResources.test.ts — строки панели в интерфейсе на обоих языках.
// Три копии разошлись: промпт знал только детскую линию, интерфейс звал 112
// «телефоном доверия» (R3-027). Английская панель показывала линии США, а
// модель при этом получала российские номера — сервис работает в России,
// поэтому и в английском интерфейсе номера те же, переведены только подписи.
export const CRISIS_RESOURCES_RU: ReadonlyArray<{ number: string; who: string; en: string }> = [
  { number: '8-800-333-44-34', who: 'горячая линия психологической поддержки, бесплатно и круглосуточно', en: '8-800-333-44-34 — psychological support hotline, free and 24/7' },
  { number: '051 (с мобильного: +7 495 051)', who: 'Московская служба психологической помощи населению', en: '051 (from a mobile: +7 495 051) — Moscow psychological help service' },
  { number: '8-800-2000-122', who: 'телефон доверия для детей, подростков и их родителей', en: '8-800-2000-122 — helpline for children, teenagers and their parents' },
  { number: '112', who: 'экстренные службы', en: '112 — emergency services' },
];

export const CRISIS_RESOURCES_LINE_RU = CRISIS_RESOURCES_RU.map(r => `${r.number} — ${r.who}`).join('; ');
