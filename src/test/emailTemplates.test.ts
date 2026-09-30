// R4-042: письма учили вводить код вручную, а поля для кода в приложении нет;
// английского текста не было вовсе — язык получателя сервер не знает, поэтому
// каждое письмо двуязычное, и ссылка в обеих частях одна и та же.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const templates = ['confirm', 'recovery', 'invite'];

describe.each(templates)('public/email/%s.html', name => {
  const html = readFileSync(`public/email/${name}.html`, 'utf8');
  const body = html.replace(/<!--[\s\S]*?-->/g, '');

  it('без кода для ручного ввода', () => {
    expect(body).not.toContain('.Token }}');
  });

  it('есть английский текст с той же ссылкой', () => {
    expect(body).toContain('Hello!');
    const links = body.match(/href="\{\{[^"]+"/g) ?? [];
    expect(links).toHaveLength(2);
    expect(links[0]).toBe(links[1]);
  });
});
