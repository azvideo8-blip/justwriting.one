#!/usr/bin/env node
// A-12: каждый кадр руководства обязан идти через <picture> с WebP-источником,
// и все файлы этого srcset должны существовать на диске. Иначе браузер молча
// останется на JPEG, а исходный файл можно случайно удалить.
// Запуск: node scripts/check-docs-webp.mjs [корень]; выход 1 при находке.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { isMainRun } from './gate-paths.mjs';

export function findBrokenDocPictures(root = process.cwd()) {
  const docs = join(root, 'public', 'docs');
  const pages = readdirSync(docs, { recursive: true })
    .map(entry => String(entry))
    .filter(file => file.endsWith('.html'))
    .sort();
  const problems = [];

  for (const page of pages) {
    const file = join(docs, page);
    const html = readFileSync(file, 'utf8');
    const pictures = [...html.matchAll(/<picture>([\s\S]*?)<\/picture>/g)];
    const imgCount = (html.match(/<img\s/g) ?? []).length;
    if (imgCount !== pictures.length) {
      problems.push(`${page}: <img> ${imgCount}, <picture> ${pictures.length}`);
    }

    for (const [, block] of pictures) {
      const source = block.match(/<source\s+type="image\/webp"\s+srcset="([^"]+)"/);
      if (!source) {
        problems.push(`${page}: <picture> без <source type="image/webp">`);
      } else {
        for (const part of source[1].split(',')) {
          const url = part.trim().split(/\s+/)[0];
          if (!url) continue;
          const disk = join(dirname(file), url);
          if (!existsSync(disk)) problems.push(`${page}: нет файла ${url}`);
        }
      }

      const img = block.match(/<img\s+src="([^"]+)"/);
      if (!img) {
        problems.push(`${page}: <picture> без <img>`);
      } else if (!existsSync(join(dirname(file), img[1]))) {
        problems.push(`${page}: нет файла ${img[1]}`);
      }
    }
  }

  return problems;
}

if (isMainRun(process.argv[1], import.meta.url)) {
  const root = process.argv[2] ?? process.cwd();
  const problems = findBrokenDocPictures(root);
  for (const problem of problems) console.log(`::error::${problem}`);
  console.log(`docs-webp: ${problems.length ? 'ошибки' : 'ok'} (${relative(process.cwd(), join(root, 'public', 'docs'))})`);
  process.exit(problems.length ? 1 : 0);
}
