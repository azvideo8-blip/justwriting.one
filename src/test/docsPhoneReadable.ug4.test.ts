// UG-4 (SA-21): /docs должен читаться на телефоне. Правила здесь — те, что
// нельзя померить одним glance'ом в браузере и которые однажды уже вернулись бы
// незаметно: капс, развёрнутое на 16 строк оглавление до первого абзаца,
// ссылки-тычинки меньше 44 px и десктопный кадр, сжатый до ширины экрана.
//
// Мутация: вернуть `<nav class="toc">` на любой странице → красен кейс 1;
// вернуть `text-transform: uppercase` → кейс 2; снять `min-height: 44px` у
// `.toc a` → кейс 3; убрать `figure.shot` из листающего блока → кейс 4.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public/docs';
const pages = readdirSync(DIR).filter(f => f.endsWith('.html'));
// UG-3: мобильные страницы обязаны держать те же правила, что и десктопные.
const mobileDir = `${DIR}/mobile`;
const mobilePages = existsSync(mobileDir) ? readdirSync(mobileDir).filter(f => f.endsWith('.html')) : [];
const css = readFileSync(`${DIR}/docs.css`, 'utf8');
const narrow = css.slice(css.indexOf('@media (max-width: 860px)'), css.indexOf('@media print'));

describe('UG-4: /docs на телефоне', () => {
  it('оглавление — свёрнутый <details> с подписью, и стоит после первого абзаца', () => {
    expect(pages.length).toBeGreaterThanOrEqual(9);
    for (const f of pages) {
      const html = readFileSync(`${DIR}/${f}`, 'utf8');
      expect(html, `${f}: оглавление не стало <details>`).toContain('<details class="toc"');
      expect(html, `${f}: у <details> нет <summary>`).toMatch(/<details class="toc"[\s\S]{0,160}?<summary>/);
      expect(html, `${f}: прежний <nav class="toc"> вернулся`).not.toContain('<nav class="toc"');
      // Первый абзац обязан идти ДО оглавления — иначе на 390 он за экраном.
      const lead = html.indexOf('class="lead"');
      const toc = html.indexOf('<details class="toc"');
      expect(lead, `${f}: на странице нет вводного абзаца .lead`).toBeGreaterThan(-1);
      expect(lead < toc, `${f}: оглавление стоит раньше первого абзаца`).toBe(true);
    }
  });

  it('ни одной капслоновой подписи в оглавлении и навигации', () => {
    expect(css, 'вернулся text-transform: uppercase').not.toMatch(/text-transform:\s*uppercase/);
  });

  it('на телефоне ссылки оглавления, перехода и шапки — не меньше 44 px', () => {
    expect(narrow).toMatch(/\.toc a \{[^}]*min-height: 44px/);
    expect(narrow).toMatch(/\.pager a \{[^}]*min-height: 44px/);
    expect(narrow).toMatch(/\.topbar \.app-link \{[^}]*min-height: 44px/);
    // MQ-16 уже ставила подвал в колонку по 44 px — не потерять бы это.
    expect(narrow).toMatch(/\.footer-links li \{[^}]*min-height: 44px/);
  });

  it('десктопный кадр не сжимается в ширину экрана: он листается', () => {
    expect(narrow).toMatch(/figure\.shot \{[^}]*overflow-x: auto/);
    expect(narrow).toMatch(/figure\.shot img \{[^}]*min-width: 900px/);
    expect(narrow).toMatch(/figure\.shot figcaption \{[^}]*position: sticky/);
  });

  it('мобильных страниц пять, и все они не связаны из приложения', () => {
    expect(mobilePages.sort()).toEqual(['ai.html', 'index.html', 'notes.html', 'profile.html', 'writing.html']);
    for (const f of mobilePages) {
      const html = readFileSync(`${mobileDir}/${f}`, 'utf8');
      // те же правила читаемости, что у десктопных страниц
      expect(html, `${f}: нет <details class="toc">`).toContain('<details class="toc"');
      expect(html, `${f}: нет <summary> у оглавления`).toMatch(/<summary>На этой странице<\/summary>/);
      expect(html, `${f}: нет viewport`).toContain('name="viewport"');
      expect(html, `${f}: css подключается не оттуда`).toContain('href="../docs.css"');
      for (const m of html.matchAll(/<img[^>]*>/g)) {
        const w = Number((m[0].match(/width="(\d+)"/) ?? [])[1] ?? '0');
        expect(w, `${f}: кадр шире 400 px — телефонная версия не нужна только мобильному снимку`).toBeLessThanOrEqual(400);
        expect(m[0], `${f}: у кадра нет alt`).toContain('alt="');
        expect(m[0], `${f}: кадр без loading="lazy"`).toContain('loading="lazy"');
      }
      // каждая ссылка на картинку ведёт в существующий файл
      for (const m of html.matchAll(/<img[^>]*src="([^"]+)"/g)) {
        expect(existsSync(`${mobileDir}/${m[1]}`), `${f}: нет файла ${m[1]}`).toBe(true);
      }
    }
  });

  // 0.10.0: ссылка добавлена — телефонное руководство открывает /guide в
  // мобильном макете (GuidePage, тест GuidePageMobile.v0100). Других входов нет.
  it('из приложения на эти страницы ведёт только руководство /guide', () => {
    const appSources = ['src/app/AppRoutes.tsx', 'src/features/settings', 'src/features/navigation'];
    for (const rel of appSources) {
      const abs = join(process.cwd(), rel);
      const files = existsSync(abs) && statSync(abs).isDirectory()
        ? readdirSync(abs, { recursive: true } as never).map(String).filter(x => (x.endsWith('.tsx') || x.endsWith('.ts')) && !x.includes('__tests__')).map(x => `${rel}/${x}`)
        : [rel];
      for (const f of files) {
        if (f.endsWith('pages/GuidePage.tsx')) continue;
        const src = readFileSync(f, 'utf8');
        expect(src, `${f}: ссылается на /docs/mobile`).not.toMatch(/docs\/mobile/);
      }
    }
    expect(readFileSync('src/features/navigation/pages/GuidePage.tsx', 'utf8')).toMatch(/\/docs\/mobile\//);
  });

  it('каждый широкий снимок живёт в <figure class="shot"> — иначе его нечем листать', () => {
    for (const f of pages) {
      const html = readFileSync(`${DIR}/${f}`, 'utf8');
      for (const m of html.matchAll(/<img[^>]*>/g)) {
        const tag = m[0];
        const width = Number((tag.match(/width="(\d+)"/) ?? [])[1] ?? '0');
        if (width <= 400) continue;
        const before = html.slice(Math.max(0, (m.index ?? 0) - 300), m.index);
        expect(before, `${f}: <img width="${width}"> вне figure.shot — на телефоне он нечитаем`)
          .toMatch(/<figure class="shot[^"]*">[^<]*$/);
      }
    }
  });

  it('узкие страницы не потеряли вёрстку: lint-уровень — каждый <details> закрыт', () => {
    for (const f of pages) {
      const html = readFileSync(`${DIR}/${f}`, 'utf8');
      const open = (html.match(/<details\b/g) ?? []).length;
      const close = (html.match(/<\/details>/g) ?? []).length;
      expect(open, `${f}: <details> без пары`).toBe(close);
    }
  });
});
