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

  // A-12: <picture> выбирает WebP по srcset; без переписывания пути он
  // останется относительным странице /guide/... и картинка не загрузится.
  it('переписывает srcset WebP-источников на /docs/', () => {
    const picturePage = `<html><body><main><article class="doc">
      <figure class="shot"><picture>
        <source type="image/webp" srcset="img/n-list-1280.webp 1280w, https://cdn.example.com/x.webp 2560w">
        <img src="img/n-list-1280.jpg" alt="">
      </picture></figure>
    </article></main></body></html>`;
    const html = extractGuideArticle(picturePage)!;
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    expect(doc.querySelector('source')!.getAttribute('srcset'))
      .toBe('/docs/img/n-list-1280.webp 1280w, https://cdn.example.com/x.webp 2560w');
    expect(doc.querySelector('img')!.getAttribute('src')).toBe('/docs/img/n-list-1280.jpg');
  });

  it('returns null for a page without an article', () => {
    expect(extractGuideArticle('<html><body><p>404</p></body></html>')).toBeNull();
  });

  // Аудит безопасности 27.10: защита от «javascript:» не держится только на CSP.
  // Мутация: убрать снятие опасных href → красный.
  it('drops javascript: and data: links', () => {
    const html = extractGuideArticle(`<article class="doc"><a href="javascript:alert(1)">x</a><a href=" JavaScript:alert(2)">y</a><a href="data:text/html,1">z</a><a href="java&#9;script:alert(3)">t</a><a href="sync.html">ok</a></article>`)!;
    expect(html.toLowerCase()).not.toContain('javascript:');
    expect(html).not.toContain('data:text');
    expect(html).toContain('/guide/sync');
  });
});

