import { describe, it, expect } from 'vitest';
import { extractGuideArticle } from '../GuidePage';

// Руководство внутри приложения берёт статью из статической страницы: без шапки
// «Открыть приложение», со ссылками на /guide/… и картинками из /docs/img.
describe('extractGuideArticle', () => {
  const page = `<html><body>
    <header class="topbar"><a class="app-link" href="/">Открыть приложение</a></header>
    <main><article class="doc">
      <h1>Заметки</h1>
      <a href="sync.html#offline">Облако</a> <a href="index.html">Начало</a>
      <a href="#local">Здесь</a> <a href="/help">Помощь</a> <a href="https://example.com">Сайт</a>
      <figure class="shot"><img src="img/n-list.jpg" alt=""></figure>
      <p onclick="alert(1)">Текст</p><script>window.x = 1</script>
    </article></main></body></html>`;

  it('keeps only the article and turns links and images into in-app ones', () => {
    const html = extractGuideArticle(page)!;
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    expect(html).not.toContain('Открыть приложение');
    expect([...doc.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual([
      '/guide/sync#offline', '/guide', '#local', '/help', 'https://example.com',
    ]);
    expect(doc.querySelector('img')!.getAttribute('src')).toBe('/docs/img/n-list.jpg');
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('p')!.hasAttribute('onclick')).toBe(false);
  });

  it('returns null for a page without an article', () => {
    expect(extractGuideArticle('<html><body><p>404</p></body></html>')).toBeNull();
  });
});
