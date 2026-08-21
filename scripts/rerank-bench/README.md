# Стенд AI-2: вклад облачного реранка

Отчёт: [`docs/rerank-contribution-measurement.md`](../../docs/rerank-contribution-measurement.md).

Не продуктовый код. Воспроизводит конвейер `noteRetriever` на Node, чтобы
прогнать замер по выгруженному архиву.

**Текстов заметок здесь нет и быть не должно.** `corpus-real.json` собирается из
личной выгрузки и остаётся вне репозитория. Здесь лежат только запросы, разметка
релевантности по идентификаторам и получившиеся выдачи.

```bash
# 1. корпус из выгрузки приложения (локально, наружу не уходит)
python3 -c "…"  # см. раздел «Как мерилось» в отчёте
# 2. векторы считаются на сервере, где лежит ключ
scp corpus-real.json queries-real.json embed-real.mjs justwriting:/tmp/
ssh justwriting 'cd /tmp && sudo -u justwriting env $(sudo grep -E "^(OPENROUTER_API_KEY|AI_BASE_URL|OPENROUTER_EMBED_MODEL)=" /opt/justwriting/api/.env | xargs) node embed-real.mjs'
# 3. слияние локально
node fuse.mjs
# 4. реранк на сервере
ssh justwriting 'cd /tmp && … node rerank-real.mjs'
```

Разметка в `relevance.json` — по идентификаторам заметок, без текстов. Кто и как
её ставил, написано в отчёте: это существенно для доверия к числам.
