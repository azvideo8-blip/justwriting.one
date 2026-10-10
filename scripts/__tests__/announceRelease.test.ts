import { describe, it, expect, vi } from 'vitest';
import { formatAnnouncement, sendWithRetry } from '../announce-release';

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

  it('fits the Telegram limit by dropping whole items, never cutting HTML', () => {
    const item = { category: 'fix' as const, ru: '<&>'.repeat(300), en: '' };
    const text = formatAnnouncement({ version: '1', date: '', items: [item, item, item, item] })!;
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toMatch(/…и ещё 3 — список изменений в приложении\.$/);
    expect(text.replace(/&(amp|lt|gt);/g, '').includes('&')).toBe(false);
  });
});

// 10.10.2026: объявление 0.9.35 потерялось на одном «fetch failed» — до Telegram
// с прода по IPv4 проходит один запрос из четырёх. Мутация: attempts = 1 →
// первый тест красный.
describe('sendWithRetry', () => {
  const ok = () => new Response('{}', { status: 200 });
  it('сетевой сбой повторяется, и сообщение уходит со второй попытки', async () => {
    const send = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(ok());
    const res = await sendWithRetry(send, 4, 0);
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('ответ 400 не повторяется — это не сеть', async () => {
    const send = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }));
    expect((await sendWithRetry(send, 4, 0)).status).toBe(400);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('все попытки упали — ошибка наружу', async () => {
    const send = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(sendWithRetry(send, 3, 0)).rejects.toThrow('fetch failed');
    expect(send).toHaveBeenCalledTimes(3);
  });
});
