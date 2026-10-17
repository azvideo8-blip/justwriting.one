// UG-2: подписи к снимкам в руководстве называют живые элементы интерфейса.
//
// Проверка родилась из пересъёма: alt у шести кадров описывал надписи, которых
// в приложении уже нет — «Забыли пароль шифрования?», «DOCX — Word», «Начните
// диалог с…», «Задайте пароль», «Перетащите файлы». Читатель ищет глазами то,
// чего на экране нет, и это ровно тот дефект, который руководство обязанно не
// допускать. Мутация, на которой тест краснеет: вернуть в любой alt строку,
// которой нет в интерфейсе (например «Забыли пароль шифрования?»).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/** Русские подписи из словарей + имена собеседников: их нет в translations/. */
function liveLabels(): string[] {
  const dir = 'src/shared/i18n/translations';
  const texts = readdirSync(dir).filter(f => f.endsWith('.ts'))
    .map(f => readFileSync(`${dir}/${f}`, 'utf8'));
  texts.push(readFileSync('src/features/ai/services/AIPersonaService.ts', 'utf8'));
  const out: string[] = [];
  for (const t of texts) {
    for (const m of t.matchAll(/ru:\s*'((?:[^'\\]|\\.)*)'/g)) out.push(m[1]!);
    for (const m of t.matchAll(/ru:\s*"((?:[^"\\]|\\.)*)"/g)) out.push(m[1]!);
    // имена собеседников лежат не в словарях: ru: … без кавычек-ключа
    for (const m of t.matchAll(/name:\s*'([^']{3,60})'/g)) out.push(m[1]!);
  }
  return out;
}

/** «Осталось {days} дней» покрывает и «Осталось 7 дней»: подстановку режет wildcard. */
function matchesLive(fragment: string, labels: string[]): boolean {
  const needle = fragment.replace(/^[+⋯×→\s]+/, '').trimEnd();
  if (!needle) return true;
  return labels.some(label => {
    if (label.includes(needle) || needle.includes(label)) return true;
    const parts = label.split(/\{[a-zA-Z]+\}/);
    if (parts.length < 2) return false;
    const skeleton = parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\D*?');
    return new RegExp(skeleton).test(needle);
  });
}

const labels = liveLabels();
const pages = [
  ...readdirSync('public/docs').filter(f => f.endsWith('.html')).map(f => `public/docs/${f}`),
  ...readdirSync('public/docs/mobile').filter(f => f.endsWith('.html')).map(f => `public/docs/mobile/${f}`),
];

describe('UG-2: alt-подписи руководства', () => {
  it('каждая кавычка в alt — живая надпись интерфейса', () => {
    const dead: string[] = [];
    for (const path of pages) {
      const html = readFileSync(path, 'utf8');
      for (const m of html.matchAll(/alt="([^"]*)"/g)) {
        for (const q of m[1]!.match(/«([^»]+)»/g) ?? []) {
          const fragment = q.slice(1, -1);
          if (!matchesLive(fragment, labels)) dead.push(`${path}: «${fragment}»`);
        }
      }
    }
    expect(dead, `подписи ссылаются на надписи, которых в приложении нет:\n${dead.join('\n')}`).toEqual([]);
  });

  it('проверка не холостая: кавычки в alt действительно есть', () => {
    const total = pages.reduce((n, path) => {
      const html = readFileSync(path, 'utf8');
      return n + [...html.matchAll(/alt="[^"]*«[^»]+»[^"]*"/g)].length;
    }, 0);
    expect(total, 'ни одной подписи с кавычками — тест ничего не проверяет').toBeGreaterThan(20);
  });
});
