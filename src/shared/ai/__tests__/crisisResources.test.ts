// R3-027: один список телефонов помощи. Промпт, контекст чата и панель в
// интерфейсе разошлись: промпт знал одну детскую линию, панель звала 112
// «телефоном доверия».
import { describe, it, expect } from 'vitest';
import { CRISIS_RESOURCES_RU } from '../crisisResources';
import { SAFETY_GUIDE } from '../prompts';
import { aiTranslations } from '../../i18n/translations/ai';

describe('crisis resources', () => {
  it('промпт называет каждый телефон из списка', () => {
    for (const r of CRISIS_RESOURCES_RU) expect(SAFETY_GUIDE).toContain(r.number);
  });

  it('русская панель — ровно этот список, по порядку', () => {
    const ru = [1, 2, 3, 4].map(i => (aiTranslations as Record<string, { ru: string }>)[`ai_crisis_resource_${i}`]!.ru);
    expect(ru).toEqual(CRISIS_RESOURCES_RU.map(r => `${r.number} — ${r.who}`));
  });
});
