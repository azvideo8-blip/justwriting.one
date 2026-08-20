# Стенд для сравнения моделей эмбеддингов

Отчёт: [`docs/local-embeddings-measurement.md`](../../docs/local-embeddings-measurement.md).

Не продуктовый код. Ничего отсюда не импортируется приложением.

```bash
npm install @huggingface/transformers   # во временном каталоге, не в проект
node run-local.mjs Xenova/multilingual-e5-small prefix
DTYPE=fp32 node run-local.mjs Xenova/multilingual-e5-small prefix
node score.mjs
```

Облачная модель считается на сервере, где лежит ключ:

```bash
scp corpus.json queries.json run-cloud.mjs justwriting:/tmp/
ssh justwriting 'cd /tmp && sudo -u justwriting env $(sudo grep -E "^(OPENROUTER_API_KEY|AI_BASE_URL|OPENROUTER_EMBED_MODEL)=" /opt/justwriting/api/.env | xargs) node run-cloud.mjs'
```

`out-*.json` — сырые выдачи прогонов, по которым посчитана таблица в отчёте.
Они лежат в репозитории намеренно: отчёт, который нельзя перепроверить, ничем
не лучше выдуманного.

Правильные ответы в `queries.json` размечены вручную и записи составлены так,
чтобы нужная заметка не содержала слов запроса. Если будете добавлять запросы,
держите это правило — иначе стенд начнёт мерить совпадение слов.
