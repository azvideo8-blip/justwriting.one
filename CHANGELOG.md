# Changelog

## 0.8.15 — 2026-08-24

- **[RU]** Выход с очисткой больше не обещает лишнего. Если стереть данные на этом компьютере не удалось — залоченная база, отказ браузера, — раньше об этом узнавал только журнал, а человек уходил от чужой машины с сообщением «локальные данные удалены». Теперь выход состоится, но прямо скажет, что осталось и как это убрать.
- **[EN]** Signing out with a wipe no longer promises more than it did. If erasing the data on this computer failed — a locked database, a browser refusing — only the log used to know, while the person walked away from a shared machine having read «local data deleted». Sign-out still completes, but now says plainly what stayed and how to remove it.
- **[RU]** Загрузка данных из облака перестала рапортовать об успехе после провала. Падение теперь так и называется, «нечего восстанавливать» отличается от «прервано ошибкой», а частичный успех сообщается числами: сколько вернулось до того, как всё встало.
- **[EN]** Restoring from the cloud no longer reports success after a failure. A crash is now called a crash, «nothing to restore» is told apart from «interrupted by an error», and partial success is reported in numbers: how much came back before things stopped.
- **[RU]** Неудачная попытка фонового восстановления больше не откладывает следующую на сутки, а отсчёт ведётся по аккаунту, а не на весь браузер.
- **[EN]** A failed background restore no longer postpones the next attempt by a day, and the countdown is kept per account instead of per browser.
- **[RU]** Перевод старого шифрования на новое теперь выдаёт код восстановления. Раньше сейф создавался без него — и забытый пароль означал навсегда нечитаемый архив.
- **[EN]** Migrating the old encryption to the new one now issues a recovery code. The vault used to be created without one — and a forgotten password meant a permanently unreadable archive.
- **[RU]** Журнал ошибок перестал уносить с собой опознавательные данные: путь записи содержал внутри себя идентификатор аккаунта, а текст самого сообщения не фильтровался вовсе. Теперь в журнал уходит форма, а не значение.
- **[EN]** The error log no longer carries identifying data along with it: a record's path held the account id inside itself, and the message text was not filtered at all. The log now receives the shape, not the value.
- **[RU]** Удаление аккаунта требует ввести пароль заново — и это проверяется не только на экране, но и на сервере. Одолженного разблокированного ноутбука больше недостаточно, чтобы стереть архив.
- **[EN]** Deleting an account now requires the password again — and it is checked on the server, not only on screen. A borrowed unlocked laptop is no longer enough to erase the archive.
- **[RU]** У фоновых обращений к ИИ появился предел частоты, а не только суточный потолок: раньше весь дневной запас можно было израсходовать за минуту.
- **[EN]** Background AI calls now have a rate limit, not just a daily ceiling: the whole day's allowance could previously be spent in a minute.
- **[RU]** Общий потолок расхода учитывает и отправленный текст, а не только ответ. Длинная заметка, ушедшая на разбор, стоила токенов, которых потолок не видел.
- **[EN]** The shared spending ceiling now counts the text sent, not only the answer. A long note sent for analysis cost tokens the ceiling never saw.
- **[RU]** Приёмник отчётов о нарушениях политики безопасности перестал принимать неограниченный поток с одного адреса — и защита поставлена на тот вход, которым приложение действительно пользуется, а не только на запасной. В журнал вместо полного адреса страницы теперь идёт только его начало.
- **[EN]** The security-policy report sink no longer accepts an unlimited stream from a single address — and the protection sits on the entrance the app actually uses, not only on the spare one. The log now keeps the beginning of a page address instead of the whole thing.
- **[RU]** Профиль открывается быстрее и тише: раньше ради счётчиков слов расшифровывался весь архив, хотя те же числа уже лежат в записи каждой заметки.
- **[EN]** The profile opens faster and quieter: the whole archive used to be decrypted for word counters, though the same numbers already sit in each note's record.
- **[RU]** Правка заметки обновляет поисковый указатель точечно, а не пересобирает его по всему архиву.
- **[EN]** Editing a note updates the search index in place instead of rebuilding it across the whole archive.
- **[RU]** Значок синхронизации перестал опрашивать хранилище каждые десять секунд и теперь узнаёт об изменениях от самого механизма синхронизации.
- **[EN]** The sync indicator no longer polls storage every ten seconds and now learns about changes from the sync layer itself.
- **[RU]** Служебные части приложения перестали держать два независимых набора подключений к базе там, где нужен один.
- **[EN]** The service side of the app no longer keeps two independent sets of database connections where one is needed.
- **[RU]** Из настроек, диагностики и текстов убраны последние следы прежнего облачного хранилища — переменные, названия и подсказки, которые вели не туда.
- **[EN]** The last traces of the previous cloud storage are gone from settings, diagnostics and texts — variables, names and hints that pointed nowhere.

## 0.8.14 — 2026-08-22

- **[RU]** Поиск по имени снова работает. «Про Сашу» не находил записи, где написано «Сашей»: короткие имена отсекались по длине, а проверка заглавной буквы не срабатывала никогда — текст приводился к нижнему регистру раньше неё.
- **[EN]** Searching by name works again. «Про Сашу» did not find entries that say «Сашей»: short names were cut off by length, and the capital-letter check never fired because the text was lowercased before it.
- **[RU]** Под тридцать две правки прошлого выпуска подведена страховка: сорок шесть новых проверок, и каждая испытана снятием защиты — сначала убедились, что она краснеет на неисправленном коде, и только потом что зеленеет на исправленном.
- **[EN]** The thirty-two fixes of the previous release now have a safety net: forty-six new checks, each of them proven by disabling the fix — first confirming it goes red on the unfixed code, and only then that it goes green on the fixed one.
- **[RU]** Проверки прав доступа к базе перестали рапортовать об успехе раньше времени: итоговое сообщение печаталось до того, как отрабатывала треть проверок.
- **[EN]** Database access checks no longer report success early: the final message was printed before a third of the checks had run.

## 0.8.13 — 2026-08-22

- **[RU]** Заметка больше не размножается при сохранении. Каждое сохранение могло создать в облаке ещё одну копию той же записи, и архив постепенно зарастал двойниками.
- **[EN]** A note no longer multiplies when saved. Every save could create another cloud copy of the same entry, and the archive slowly filled with twins.
- **[RU]** Версия записи больше не пропадает при совпадении номеров. Две версии с одинаковым номером считались одной и той же, и вторая исчезала; теперь они различаются по содержимому.
- **[EN]** A version no longer disappears when numbers collide. Two versions with the same number were treated as one and the second vanished; they are now told apart by content.
- **[RU]** Удалённая заметка больше не воскресает. У удаления не было следа, поэтому другое устройство считало заметку новой и возвращало её обратно. Теперь след остаётся, а содержимое стирается по-настоящему.
- **[EN]** A deleted note no longer comes back. Deletion left no trace, so another device saw the note as new and restored it. The trace now remains, and the content is genuinely erased.
- **[RU]** Синхронизация перестала застревать навсегда. При расхождении служебных данных заметка упиралась в одну и ту же ошибку при каждой попытке; теперь состояние восстанавливается по последней версии.
- **[EN]** Sync no longer gets stuck forever. When bookkeeping diverged, a note hit the same error on every attempt; the state is now rebuilt from the latest version.
- **[RU]** Автосохранение больше не приземляется после завершения сессии, переписывая уже законченную запись более старым текстом.
- **[EN]** Autosave no longer lands after a session is finished, overwriting a completed entry with older text.
- **[RU]** Ошибка при перешифровании архива больше не проходит молча. Неудачная запись пропускалась, и заметка оставалась в облаке открытым текстом навсегда — при том что сверху всё выглядело успешным.
- **[EN]** A failure while re-encrypting the archive no longer passes silently. A failed write was skipped and the note stayed in the cloud as plain text forever, while the operation reported success.
- **[RU]** Удаление заметки в облаке убирает и её разбор с поисковыми векторами. Раньше они оставались сиротами и всплывали в поиске.
- **[EN]** Deleting a note in the cloud now removes its analysis and search vectors too. They used to linger as orphans and surface in search.
- **[RU]** Заметка, исключённая из работы с ИИ, больше не уходит поставщику. Пометка учитывалась при показе, но не при сборе материала для ответа.
- **[EN]** A note excluded from AI no longer reaches the provider. The exclusion was honoured when displaying but not when gathering material for an answer.
- **[RU]** Сравнение периодов больше не подмешивает заметки соседнего периода: выбранное окно времени не учитывалось при повторных запросах.
- **[EN]** Period comparison no longer mixes in notes from a neighbouring period: the selected time window was ignored on repeat queries.
- **[RU]** Поисковый кэш и признак «запомнить это устройство» сбрасываются при выходе из аккаунта. Раньше следы прежнего входа оставались в браузере.
- **[EN]** The search cache and the «remember this device» flag are cleared on sign-out. Traces of the previous session used to stay in the browser.
- **[RU]** Служебный признак с устройства больше не отключает дневной лимит и паузу между вызовами ИИ.
- **[EN]** A device-supplied flag can no longer switch off the daily AI limit and the cooldown between calls.
- **[RU]** Журнал ошибок в браузере больше не хранит исходный текст сбоя, куда могли попадать фрагменты записей.
- **[EN]** The in-browser error log no longer stores the raw failure text, which could contain fragments of entries.
- **[RU]** Список пользователей в админской части перестал выгружать в браузер все колонки подряд, включая чужие служебные поля.
- **[EN]** The admin user list no longer pulls every column into the browser, including other people service fields.
- **[RU]** Адрес почты больше нельзя изменить из браузера — он синхронизируется со стороны сервера.
- **[EN]** The email address can no longer be changed from the browser — it is synchronised server-side.
- **[RU]** «Регенерировать» больше не теряет прежний ответ, если новый не удался.
- **[EN]** Regenerate no longer loses the previous answer when the new one fails.
- **[RU]** Смена собеседника посреди ответа больше не сохраняет в диалог устаревший снимок, а повторное нажатие «отправить» не превращается в ошибку.
- **[EN]** Switching persona mid-answer no longer saves a stale snapshot into the dialogue, and a double press of send no longer turns into an error.
- **[RU]** Исчерпанный лимит показывается как исчерпанный лимит, а не «произошла ошибка», и больше не приводит ко второму платному вызову.
- **[EN]** A reached limit is shown as a reached limit rather than a generic failure, and no longer causes a second billed call.
- **[RU]** Фильтр в архиве больше не тратит месячную заморозку серии. Простое переключение фильтра засчитывалось как пропуск.
- **[EN]** Filtering the archive no longer spends the monthly streak freeze. Switching a filter counted as a missed day.
- **[RU]** Продолжение старой заметки больше не уменьшает счётчик сессий, а подпись под ним теперь честно говорит «сессий», а не «заметок».
- **[EN]** Continuing an old note no longer decreases the session counter, and its label now honestly says sessions rather than notes.
- **[RU]** Превью заметки больше не показывает старый текст при совпадении номеров версий.
- **[EN]** A note preview no longer shows old text when version numbers collide.
- **[RU]** Неудача одного раздела портрета больше не затирает готовый портрет целиком, а удалённые заметки не оставляют в нём призраков.
- **[EN]** A failure in one part of the portrait no longer wipes the finished portrait, and deleted notes leave no ghosts in it.
- **[RU]** Оценка стоимости обновления портрета была занижена в двенадцать раз — теперь она правдива.
- **[EN]** The cost estimate for refreshing the portrait was twelve times too low — it is now truthful.
- **[RU]** Напоминание «успеть к 22:30» больше не срабатывает на первой секунде сессии.
- **[EN]** The finish-by-22:30 reminder no longer fires in the first second of a session.
- **[RU]** Проверка текста на попытки обмануть модель ускорена в пятьдесят раз: на длинной записи она занимала секунду и могла подвесить страницу.
- **[EN]** The check for attempts to trick the model is fifty times faster: on a long entry it took a second and could freeze the page.
- **[RU]** Служба принимает пропуска только от собственного сервера входа и отказывается запускаться, если это не настроено. Прежде подошёл бы любой пропуск, подписанный общим ключом.
- **[EN]** The service accepts passes only from its own sign-in server and refuses to start if that is not configured. Previously any pass signed with the shared key would do.
- **[RU]** Ворота качества снова работают: проверки не проходили с 3 августа, и выкатка шла мимо них. Покрытие тестами поднято с 87,7% до 92,0%.
- **[EN]** The quality gates work again: checks had been failing since 3 August and deployments went around them. Test coverage is up from 87.7% to 92.0%.

## 0.8.12 — 2026-08-21

- **[RU]** Приложение снова открывается. Сборка, выложенная автоматикой, не получила настроек подключения к базе — они вшиваются в момент сборки, а на сервере сборки их не было. Сайт при этом отвечал исправно, и снаружи всё выглядело рабочим.
- **[EN]** The app opens again. The build produced by the deployment automation had no database connection settings — they are baked in at build time, and the build machine did not have them. The site itself answered normally, so from the outside everything looked fine.

Более старые записи — в [docs/changelog-archive.md](docs/changelog-archive.md).
