import { describe, expect, it } from 'vitest';
import { diffPostAgainstNote } from '../editorDiff';
import { SYNTH } from './synthEditorPosts.ed2';

// ED-2, бюджет ложных срабатываний: 20 синтетических постов без имён и все
// post/source-пары из editorDiff.q10. Больше одного ложного на 20 = провал, а
// попадания по фикстурам — только настоящие имена, оставленные в посте.

// Синтетические пары — в фикстуре SYNTH (тот же набор нужен бюджету LD-1).

// Фикстуры Редактора из editorDiff.q10.test.ts (post, source) — там, где имена
// есть, они считаются намеренно: проверяем, что namesKept не выдумывает лишнего.
const REPO: Array<[string, string]> = [
  ['Брат позвонил рано утром. Подруга выручила деньгами, и всё это висит над головой.', 'Утром позвонил Тимур, а Оля одолжила 54 000 и напомнила про 5:50.'],
  ['Олю пришлось уговаривать полчаса, а она ведь только хотела помочь.', 'Утром позвонил Тимур, а Оля одолжила 54 000 и напомнила про 5:50.'],
  ['Разговор вышел тяжёлый, и я его отложила.', 'Сегодня был тяжёлый разговор, и я его отложила.'],
  ['Подруга написала первой. Брат звонил рано.', 'Оля написала первой. Тимур звонил в 5:50.'],
  ['Анализ показал что-то.', 'Аня пришла.'],
  ['Было только олень и лето.', 'Оля, Лев и Аня пришли.'],
  ['Было тихо. Пришла Оля.', 'Сегодня было тихо. Потом пришла Оля.'],
  ['Было тихо. Пришла Оля.', 'Днём было тихо. Потом пришла Оля.'],
  ['Встречу отменила. Позвонила позже.', 'Решила отменить встречу. Оля звонила.'],
  ['Сделать отчёт до конца недели.', 'Подготовить отчёт до пятницы.'],
  ['Ночью спорить не стоит.', 'Важно не спорить ночью.'],
  ['Никого не было.', 'Никто не звонил.'],
  ['Льва не было дома.', 'Лев звонил вечером.'],
  ['Льгота отменяется.', 'Лев звонил вечером.'],
  ['Переписано другими словами.', 'Кравко принёс документы.'],
  ['Брат звонил.', 'Павел звонил.'],
  ['Друг позвонил утром.', 'Максим позвонил утром.'],
  ['Коллега опять опоздал.', 'Артём опять опоздал.'],
  ['Подруга пришла в гости.', 'Мила пришла в гости.'],
  ['Всё решили завтра.', 'Маму звали вечером. Мы говорили про маму.'],
];

function hits(pairs: Array<[string, string]>, label: string) {
  const found: Array<Record<string, unknown>> = [];
  for (const [post, source] of pairs) {
    const d = diffPostAgainstNote(post, source);
    if (d.namesKept.length > 0) found.push({ label, post, kept: d.namesKept });
  }
  console.log(`ED2_BUDGET ${label}`, JSON.stringify(found, null, 2));
  return found;
}

// MD-4: тот же бюджет нужен новой плашке о чужих словах — иначе она шумит на
// каждом посте и автор перестаёт в неё верить.
function foreignHits(pairs: Array<[string, string]>, label: string) {
  const found: Array<Record<string, unknown>> = [];
  for (const [post, source] of pairs) {
    const d = diffPostAgainstNote(post, source);
    if (d.foreignSpeechInPost) found.push({ label, post });
  }
  console.log(`MD4_BUDGET ${label}`, JSON.stringify(found, null, 2));
  return found;
}

describe('ED-2 бюджет ложных срабатываний', () => {
  it('печатает попадания по 20 постам без имён и по фикстурам репозитория', () => {
    const synth = hits(SYNTH, 'synth');
    const repo = hits(REPO, 'repo');
    expect(SYNTH).toHaveLength(20);
    expect(REPO).toHaveLength(20);
    // Порог тикета: больше одного ложного на 20 постов = провал.
    expect(synth).toHaveLength(0);
    // Каждое попадание по фикстурам — настоящее имя (Оля осталась в посте).
    expect(new Set(repo.flatMap(r => r.kept as string[]))).toEqual(new Set(['Оля']));
  });

  it('плашка MD-4: не больше одного ложного на 20 постов', () => {
    expect(foreignHits(SYNTH, 'synth')).toHaveLength(0);
    expect(foreignHits(REPO, 'repo')).toHaveLength(0);
  });
});
