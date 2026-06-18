import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join, extname } from 'path';
import { createServer } from 'http';
import { chromium, type Browser, type Page } from '@playwright/test';

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
  {
    path: '/privacy',
    titleRu: 'Политика конфиденциальности — justwriting',
    titleEn: 'Privacy Policy — justwriting',
    descriptionRu: 'Как justwriting собирает, хранит и обрабатывает ваши данные. Шифрование, ИИ-функции, аналитика, права пользователя.',
    descriptionEn: 'How justwriting collects, stores, and processes your data. Encryption, AI features, analytics, user rights.',
  },
  {
    path: '/terms',
    titleRu: 'Условия использования — justwriting',
    titleEn: 'Terms of Service — justwriting',
    descriptionRu: 'Условия использования приложения justwriting. Ответственность, допустимое использование, права пользователя.',
    descriptionEn: 'Terms of Service for justwriting app. Liability, acceptable use, user rights.',
  },
];

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
};

const BLOCKED_HOSTS = [
  'sentry.io',
  'posthog.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'google-analytics.com',
  'googletagmanager.com',
];

function stripStaticSeoTags(html: string): string {
  let result = html;
  result = result.replace(/<html\s+lang="[^"]*"/, '<html');
  result = result.replace(/<title>[^<]*<\/title>\s*/g, '');
  result = result.replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/g, '');
  result = result.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/g, '');
  result = result.replace(/<link\s+rel="alternate"\s+hreflang="[^"]*"\s+href="[^"]*"\s*\/?>/g, '');
  for (const prop of ['og:title', 'og:description', 'og:url', 'og:image', 'og:locale', 'og:site_name']) {
    result = result.replace(
      new RegExp(`<meta\\s+property="${prop.replace(':', '\\:')}"\\s+content="[^"]*"\\s*\\/?>`, 'g'),
      '',
    );
  }
  for (const name of ['twitter:title', 'twitter:description', 'twitter:image', 'twitter:site', 'twitter:creator']) {
    result = result.replace(
      new RegExp(`<meta\\s+name="${name.replace(':', '\\:')}"\\s+content="[^"]*"\\s*\\/?>`, 'g'),
      '',
    );
  }
  return result;
}

function createStaticServer(rootDir: string, spaHtml: string) {
  return createServer((req, res) => {
    const urlPath = (req.url?.split('?')[0] || '/').replace(/\/+$/, '') || '/';

    if (!extname(urlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(spaHtml);
      return;
    }

    const filePath = join(rootDir, urlPath);
    try {
      const data = readFileSync(filePath);
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });
}

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

function writePage(page: PageMeta, html: string): void {
  if (page.path === '/') {
    writeFileSync(resolve(DIST, 'index.html'), html);
  } else {
    const dir = resolve(DIST, page.path.slice(1));
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'index.html'), html);
  }
}

async function prerenderWithPlaywright(originalHtml: string, spaHtml: string): Promise<void> {
  const server = createStaticServer(DIST, spaHtml);

  const port = await new Promise<number>((res, rej) => {
    server.on('error', rej);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') res(addr.port);
      else rej(new Error('failed to bind'));
    });
  });

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    await context.addInitScript(() => {
      try {
        localStorage.setItem('app_language', 'ru');
      } catch {
        // ignore
      }
    });

    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (BLOCKED_HOSTS.some((h) => url.includes(h))) {
        route.abort();
      } else {
        route.continue();
      }
    });

    for (const page of pages) {
      let p: Page | null = null;
      try {
        p = await context.newPage();
        const url = `http://127.0.0.1:${port}${page.path}`;
        await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await p.waitForSelector('#root > *', { timeout: 10000 });
        try {
          await p.waitForLoadState('networkidle', { timeout: 8000 });
        } catch {
          // networkidle timeout is non-fatal
        }
        await p.waitForTimeout(1000);
        const html = await p.content();
        writePage(page, html);
        console.log(`  prerender: ${page.path} (Playwright)`);
      } catch (err) {
        const html = buildPage(page, originalHtml);
        writePage(page, html);
        console.log(`  prerender: ${page.path} (fallback: ${String(err)})`);
      } finally {
        if (p) await p.close().catch(() => {});
      }
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

async function main(): Promise<void> {
  const originalHtml = readFileSync(resolve(DIST, 'index.html'), 'utf-8');
  const spaHtml = stripStaticSeoTags(originalHtml);

  try {
    await prerenderWithPlaywright(originalHtml, spaHtml);
  } catch (err) {
    console.error(`Playwright prerender failed, falling back to meta-only: ${String(err)}`);
    for (const page of pages) {
      const html = buildPage(page, originalHtml);
      writePage(page, html);
      console.log(`  prerender: ${page.path} (meta-only)`);
    }
  }

  console.log('Prerender done.');
}

main().catch(console.error);
