# Стенд AI-2: вклад облачного реранка

Отчёт: [`docs/rerank-contribution-measurement.md`](../../docs/rerank-contribution-measurement.md).

Не продуктовый код. Воспроизводит конвейер `noteRetriever` на Node, чтобы
прогнать замер по выгруженному архиву.

**Никаких живых данных здесь нет и быть не должно** — ни текстов заметок, ни
запросов. Формулировки запросов сами по себе личные («конфликт с…», имя человека
рядом с рабочим контекстом), поэтому `corpus-real.json`, `queries-real.json`,
`relevance.json` и `out-orderings.json` собираются локально из личной выгрузки и
закрыты в `.gitignore`. В репозиторий едут только скрипты и обезличенный отчёт.

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

Разметка в `relevance.json` — по идентификаторам заметок, без текстов, и лежит
только локально. Кто и как её ставил, написано в отчёте: это существенно для
доверия к числам. В отчёте запросы идут под номерами; таблица соответствия
номеров и настоящих формулировок остаётся в личной выгрузке.
