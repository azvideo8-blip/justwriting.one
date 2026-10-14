// PX-3: версия промптов разделов портрета. Правка любого из пяти обязана менять
// хэш — иначе портреты прежних правил (до 2026-09-23) останутся «свежими», и
// подсказка в Профиле не появится никогда.
import { describe, expect, it } from 'vitest';
import { SYSTEM_TASK_PROMPTS, portraitPromptsVersion } from '../systemTaskPrompts';

const FIVE = [
  SYSTEM_TASK_PROMPTS.profileThemes,
  SYSTEM_TASK_PROMPTS.profileEmotionalPatterns,
  SYSTEM_TASK_PROMPTS.profileStrengths,
  SYSTEM_TASK_PROMPTS.profileGrowth,
  SYSTEM_TASK_PROMPTS.profileCommunication,
];

describe('PX-3: portraitPromptsVersion', () => {
  it('совпадает с хэшем ровно пяти промптов разделов', () => {
    expect(portraitPromptsVersion()).toBe(portraitPromptsVersion(FIVE));
  });

  it('меняется, когда правится любой из пяти', () => {
    const base = portraitPromptsVersion(FIVE);
    FIVE.forEach((_, i) => {
      const edited = FIVE.map((p, j) => (j === i ? `${p} +` : p));
      expect(portraitPromptsVersion(edited), `раздел ${i}`).not.toBe(base);
    });
  });

  it('не совпадает с версией из четырёх разделов — один промпт не потеряется', () => {
    expect(portraitPromptsVersion(FIVE.slice(0, 4))).not.toBe(portraitPromptsVersion(FIVE));
    expect(portraitPromptsVersion([...FIVE.slice(1), FIVE[0]!])).not.toBe(portraitPromptsVersion(FIVE));
  });

  it('стабилен между вызовами и короткий', () => {
    const v = portraitPromptsVersion();
    expect(v).toBe(portraitPromptsVersion());
    expect(v).toMatch(/^[0-9a-f]{8}$/);
  });
});
