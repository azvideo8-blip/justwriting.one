// SA-7: харнес реранка шлёт продовый контракт, а не свой.
//
// Раньше здесь лежала своя копия промпта ранжирования и свой формат ответа
// ({"ids":[...]} вместо проду {"idx":[...]}). Бенчмарк мерил соглашение модели
// с другим промптом, а вывод переносился на прод. Теперь промпт, форма
// user-сообщения и разбор — из src/shared/ai/rerankPrompt.ts, тело — из
// src/shared/ai/requestConfig.ts (SA-8).
//
// Пустой content — ошибка харнеса, а не вердикт «модель не нашла ничего
// релевантного»: ранее молчание транспорта попадало в точность.
//
// Run: OPENROUTER_API_KEY=... node rerank-real.mjs  (входы в /tmp, см. README)

import { readFileSync, writeFileSync } from 'node:fs';
import { buildChatRequestBody, resolveChatBaseUrl } from '../../src/shared/ai/requestConfig.ts';
import {
  RERANK_SYSTEM_PROMPT,
  buildRerankUserMessage,
  parseRerankSelection,
  RerankResponseError,
} from '../../src/shared/ai/rerankPrompt.ts';

const base = resolveChatBaseUrl();
const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error('OPENROUTER_API_KEY not set'); process.exit(2); }

const notes = Object.fromEntries(JSON.parse(readFileSync('/tmp/corpus-real.json','utf8')).map(n => [n.id, n]));
const fused = JSON.parse(readFileSync('/tmp/fused.json','utf8'));

const MAX_RESULTS = 5;

const out = [];
let harnessErrors = 0;
// Строки в выводе — под номерами (З1, З2…), как в отчётах: формулировка
// запроса — личные данные, и светить ею в терминале, который кто-то показывает
// экраном, не нужно. Порядок совпадает с fused.json.
for (const [index, row] of fused.entries()) {
  const label = `З${index + 1}`;
  // Карточка как в проде: `[номер]` и заголовок с началом текста. DocId в
  // тексте не нужен — прод выбирает по номеру кандидата.
  const cards = row.candidates.map((id, i) => {
    const n = notes[id] ?? { title: '', text: '' };
    return `[${i + 1}]\n${n.title}\n${n.text.slice(0, 400)}`;
  }).join('\n\n');

  const t = Date.now();
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildChatRequestBody({
      system: RERANK_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildRerankUserMessage(row.query, cards, MAX_RESULTS) }],
      maxTokens: 512,
    })),
  });
  const ms = Date.now() - t;

  if (!r.ok) {
    harnessErrors++;
    console.error(`[ХАРНЕС ${label}] HTTP ${r.status} — ${ms}мс`);
    out.push({ ...row, rerankTop5: null, ms, harnessError: `HTTP ${r.status}` });
    continue;
  }

  const j = await r.json();
  let top5;
  try {
    top5 = parseRerankSelection(j.choices?.[0]?.message?.content ?? '', row.candidates, MAX_RESULTS);
  } catch (e) {
    if (!(e instanceof RerankResponseError)) throw e;
    harnessErrors++;
    console.error(`[ХАРНЕС ${label}] ${e.message} — это не вердикт модели`);
    out.push({ ...row, rerankTop5: null, ms, harnessError: e.message });
    continue;
  }

  out.push({ ...row, rerankTop5: top5.length ? top5 : null, ms });
  console.error(`${label}: ${top5.length ? top5.join(',') : 'ПУСТО'}  ${ms}мс`);
}

if (harnessErrors) console.error(`\nОшибок харнеса: ${harnessErrors} — эти строки не считаются вердиктом.`);
writeFileSync('/tmp/reranked.json', JSON.stringify(out, null, 1));
