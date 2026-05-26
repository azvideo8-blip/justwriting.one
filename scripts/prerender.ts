import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const DIST = resolve(import.meta.dirname, '../dist');

interface PageMeta {
  path: string;
  titleRu: string;
  titleEn: string;
  descriptionRu: string;
  descriptionEn: string;
}

const pages: PageMeta[] = [
  {
    path: '/',
    titleRu: 'justwriting — тихий редактор для свободного письма',
    titleEn: 'justwriting — a quiet editor for free writing',
    descriptionRu: 'Тихий редактор для свободного письма. Без отвлечений. Режим потока, шифрование, серия дней.',
    descriptionEn: 'A quiet editor for free writing. No distractions. Stream mode, encryption, writing streaks.',
  },
  {
    path: '/about',
    titleRu: 'О приложении — justwriting',
    titleEn: 'About — justwriting',
    descriptionRu: 'justwriting — минималистичный редактор для фрирайтинга и потокового письма. Всё сохраняется локально, облако — опционально.',
    descriptionEn: 'justwriting is a minimalist editor for freewriting and stream-of-consciousness writing. Everything saves locally, cloud is optional.',
  },
  {
    path: '/changelog',
    titleRu: 'История обновлений — justwriting',
    titleEn: 'Release notes — justwriting',
    descriptionRu: 'История обновлений тихого редактора justwriting.',
    descriptionEn: 'Release notes for justwriting, a quiet writing editor.',
  },
  {
    path: '/login',
    titleRu: 'Вход — justwriting',
    titleEn: 'Sign in — justwriting',
    descriptionRu: 'Войди в тихий редактор justwriting, чтобы сохранять заметки в облако.',
    descriptionEn: 'Sign in to justwriting, a quiet editor. Save notes to the cloud.',
  },
  {
    path: '/features',
    titleRu: 'Возможности — justwriting',
    titleEn: 'Features — justwriting',
    descriptionRu: 'Режим потока, сквозное шифрование, серия дней, дзен-режим. Тихий редактор для свободного письма.',
    descriptionEn: 'Stream mode, end-to-end encryption, writing streaks, zen mode. A quiet editor for free writing.',
  },
];

function buildPage(meta: PageMeta, indexHtml: string): string {
  const title = meta.titleRu;
  const description = meta.descriptionRu;
  const url = `https://justwriting.one${meta.path}`;
  const ogImage = 'https://justwriting.one/og-image.svg';

  let html = indexHtml;

  html = html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${description}"`);
  html = html.replace(/<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${url}"`);
  html = html.replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${title}"`);
  html = html.replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${description}"`);
  html = html.replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${url}"`);
  html = html.replace(/<meta property="og:image" content="[^"]*"/, `<meta property="og:image" content="${ogImage}"`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${title}"`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${description}"`);
  html = html.replace(/<meta name="twitter:image" content="[^"]*"/, `<meta name="twitter:image" content="${ogImage}"`);

  return html;
}

const indexHtml = readFileSync(resolve(DIST, 'index.html'), 'utf-8');

for (const page of pages) {
  const html = buildPage(page, indexHtml);
  if (page.path === '/') {
    writeFileSync(resolve(DIST, 'index.html'), html);
    console.log(`  prerender: / (index.html)`);
  } else {
    const dir = resolve(DIST, page.path.slice(1));
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'index.html'), html);
    console.log(`  prerender: ${page.path}/index.html`);
  }
}

console.log('Prerender done.');
