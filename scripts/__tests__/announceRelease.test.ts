import { describe, it, expect } from 'vitest';
import { formatAnnouncement } from '../announce-release';

describe('formatAnnouncement', () => {
  it('groups items by section, escapes HTML, keeps section order', () => {
    const text = formatAnnouncement({
      version: '1.2.3',
      date: '2026-10-02',
      items: [
        { category: 'fix', ru: 'Починили <b> & ко', en: '' },
        { category: 'new', ru: 'Новая штука', en: '' },
      ],
    });
    expect(text).toBe('<b>Версия 1.2.3 обновлена</b>\n\n<b>Новое</b>\n• Новая штука\n\n<b>Исправлено</b>\n• Починили &lt;b&gt; &amp; ко');
  });

  it('skips maintenance-only releases and maintenance items', () => {
    const maint = { category: 'fix' as const, ru: 'Служебный выпуск: что-то внутри.', en: '' };
    expect(formatAnnouncement({ version: '1', date: '', items: [maint] })).toBeNull();
    expect(formatAnnouncement({ version: '1', date: '', items: [maint, { category: 'new', ru: 'Видно людям', en: '' }] }))
      .toBe('<b>Версия 1 обновлена</b>\n\n<b>Новое</b>\n• Видно людям');
  });

  it('fits the Telegram limit', () => {
    const text = formatAnnouncement({ version: '1', date: '', items: [{ category: 'new', ru: 'я'.repeat(5000), en: '' }] });
    expect(text!.length).toBe(4096);
  });
});
