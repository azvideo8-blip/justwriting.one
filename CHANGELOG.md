# Changelog

## Unreleased — 0.9.31 (в сборке)

- **[RU]** Время, проведённое в заметке без интернета, теперь доезжает до облака. Раньше такая сессия не попадала в суммарную длительность, а следующая синхронизация копировала облачное число поверх локального — и потраченное на записях время уменьшалось.
- **[EN]** Time spent in a note offline now reaches the cloud. Such a session used to be missing from the total duration, and the next sync copied the cloud figure over the local one — so logged writing time went down.
- **[RU]** Честно о сводном числе слов: это наибольшая длина, которую заметка когда-либо имела, а не её текущая длина. Сокращение облачное число не уменьшает: на другом устройстве реальный счёт появляется только после его собственной правки, а следующий обмен с облаком возвращает прежнюю, бо́льшую отметку.
- **[EN]** About the word total: it is the largest length the note has ever had, not its current length. Shortening a note does not lower the cloud figure — another device shows the real count only after its own edit, and the next sync brings the larger, high-water number back.
- **[RU]** Правки с другого устройства приезжают без задержки, даже если часы того устройства отстают. Раньше запись, сделанная на таких часах, становилась видима остальным устройствам только спустя столько времени, насколько часы отстают.
- **[EN]** Edits from another device now arrive without delay even when that device's clock is behind. Previously a note written on such a clock stayed invisible to the other devices for as long as the clock lagged.
- **[RU]** Смена темы перекрашивает страницу одним плавным переходом. Раньше фон и текст утекали за 300 мс, а карточки, границы, сайдбар и градиент щёлкали сразу; теперь вся страница перетекает вместе за ту же треть секунды. Если в системе включено «уменьшить движение», перехода нет.
- **[EN]** Switching the theme now crossfades the whole page. The background and text used to drift for 300 ms while cards, borders, the sidebar and the gradient snapped; they all change together over the same third of a second. With reduce motion on, there is no transition.
- **[RU]** Появление без пружинного перелёта: тост о достигнутой цели и семь точек серии в финальном окне доезжают до своего размера плавно, а не выпрыгивают за него; волна столбиков на ленте серии укладывается в 0,4 с.
- **[EN]** Entrances no longer overshoot: the goal-reached toast and the seven streak dots in the finish modal settle smoothly instead of popping past their size, and the streak ribbon's bar wave now completes within 0.4 s.

## 0.9.30 — 2026-10-05

- **[RU]** Диалоги с ИИ объединяются между устройствами: реплики, написанные на разных устройствах, больше не затирают друг друга, а удалённый диалог или реплика исчезают везде. Обновите приложение на всех устройствах и во всех открытых вкладках — старая версия не видит новых реплик в длинных диалогах.
- **[EN]** AI dialogues now merge across devices: turns written on different devices no longer overwrite each other, and a deleted dialogue or turn disappears everywhere. Update the app on every device and in every open tab — an older version does not see new turns in long dialogues.
- **[RU]** В админке у пользователя появилась кнопка «Удалить» — с подтверждением, где видно, сколько у человека заметок.
- **[EN]** The admin users list has a «Delete» button, with a confirmation that shows how many notes the person has.
- **[RU]** Кризисная панель точнее: замечает «меня не будет, и никто не заметит», «скоро меня не станет», «хочу уйти из жизни» и похожие формулировки, и реже срабатывает на бытовое — «меня не будет на встрече», «ухожу из жизни соцсетей».
- **[EN]** The crisis panel is more precise: it notices «меня не будет, и никто не заметит», «скоро меня не станет», «хочу уйти из жизни» and similar phrasings, and fires less often on everyday phrases like «меня не будет на встрече».
- **[RU]** Кнопка «Открыть» убрана из шапки редактора.
- **[EN]** The «Open» button is removed from the editor header.
- **[RU]** Вход по приглашению: повторное открытие ссылки из письма больше не выкидывает из аккаунта и не «сжигает» приглашение; ссылки на политику открываются в новой вкладке, поэтому настройка не начинается заново; если ссылка уже использована, приложение так и говорит.
- **[EN]** Invitation sign-up: opening the email link a second time no longer signs you out and burns the invitation; policy links open in a new tab, so the setup doesn’t restart; a used link is now explained plainly.

## 0.9.29 — 2026-10-02

- **[RU]** Чат с ИИ без разрешения на его использование показывает спокойную подсказку и кнопку «Открыть настройки» вместо технической ошибки; набранный текст остаётся в поле ввода.
- **[EN]** Chatting with the AI before allowing it now shows a calm hint with an «Open settings» button instead of a technical error; the typed text stays in the input.
- **[RU]** Удаление аккаунта стирает с этого устройства и гостевые данные. На другом устройстве, где вы были в этом аккаунте, приложение предложит стереть его данные — после подтверждения и с предупреждением о несинхронизированном.
- **[EN]** Deleting the account also wipes guest data on this device. On another device where you used that account, the app offers to wipe its data — after a confirmation and a warning about anything unsynced.
- **[RU]** Кризисная панель замечает больше формулировок, в том числе разбитые невидимыми символами, латиницей и по-английски, и реже срабатывает на бытовые фразы.
- **[EN]** The crisis panel notices more phrasings, including ones split by invisible characters, written in Latin letters or in English, and fires less often on everyday phrases.
- **[RU]** Язык интерфейса меняется сразу во всех открытых вкладках.
- **[EN]** The interface language changes in all open tabs at once.
- **[RU]** Журнал входов в аккаунт хранится 30 дней — так и написано в политике конфиденциальности. Удалён неиспользуемый сбор анонимной статистики.
- **[EN]** Sign-in logs are kept for 30 days, as the privacy policy now says. The unused anonymous statistics collection is removed.
- **[RU]** Кнопка «Скачать копию всех своих данных (JSON)» теперь называется «Скачать заметки в JSON»: она и раньше сохраняла только заметки, полная копия всех данных — резервная копия.
- **[EN]** The JSON (GDPR) export saves your notes only, as its Russian label now says; a full copy of all data is the backup.
- **[RU]** ИИ больше не получает текст прикреплённой заметки там, где его быть не должно: при кавычке или переносе строки в названии, в старых диалогах и в итоговом резюме диалога. Заметки, скрытые от ИИ, проверяются заново при каждой отправке.
- **[EN]** The AI no longer receives an attached note’s text where it shouldn’t: with a quote or line break in the title, in old dialogues and in a dialogue’s closing summary. Notes hidden from the AI are re-checked on every send.
- **[RU]** Незаконченный черновик гостя предлагается перенести после входа; если в аккаунте уже есть черновик, гостевой сохраняется отдельной заметкой, а не пропадает.
- **[EN]** An unfinished guest draft is offered for transfer after sign-in; if the account already has a draft, the guest one is saved as a separate note instead of being lost.
- **[RU]** Если удаление аккаунта не завершилось на устройстве (сбой, закрытая вкладка), приложение честно об этом скажет и дочистит данные при следующем запуске.
- **[EN]** If deleting the account didn’t finish on the device (a crash, a closed tab), the app says so honestly and finishes the wipe on the next start.
- **[RU]** Импорт файла .docx защищён от архивов, которые раздуваются до гигабайт и роняли вкладку; слишком длинные названия, настроение и метки при импорте обрезаются до допустимых, а не ломают синхронизацию.
- **[EN]** Importing a .docx is protected from archives that inflate to gigabytes and crashed the tab; over-long titles, moods and tags are trimmed on import instead of breaking sync.
- **[RU]** Истёкший вход больше не выдаётся за «нет согласия на ИИ»; длинное название заметки больше не ломает разговор с ИИ.
- **[EN]** An expired sign-in is no longer shown as «no AI consent»; a long note title no longer breaks the AI conversation.

## 0.9.28 — 2026-10-01

- **[RU]** Служебный выпуск: восстановление базы из резервной копии больше не возвращает лишние права доступа, которые были отозваны.
- **[EN]** Maintenance release: restoring the database from a backup no longer brings back access rights that had been revoked.

## 0.9.27 — 2026-10-01

- **[RU]** Служебный выпуск: выкатку больше нельзя запустить в обход проверок, внутренние рабочие документы перенесены из основного репозитория в закрытый.
- **[EN]** Maintenance release: a deploy can no longer bypass the checks; internal working documents moved out of the main repository into a private one.

## 0.9.26 — 2026-10-01

- **[RU]** Кризисная панель замечает больше формулировок: «хочу умирать», «не хочу больше жить», «устал жить», «незачем жить», «уснуть и не проснуться», «хочу сдохнуть», «причинить себе боль», английское «don't want to live», слова, разделённые несколькими невидимыми символами. И не срабатывает на бытовое: «не хочу жить в этом городе», «покончить с прокрастинацией», «умереть от смеха», «I won't…».
- **[EN]** The crisis panel notices more phrasings: «хочу умирать», «не хочу больше жить», «устал жить», «незачем жить», «уснуть и не проснуться», «хочу сдохнуть», «причинить себе боль», English «don't want to live», words split by several invisible characters. And it stays quiet on everyday phrases: «не хочу жить в этом городе», «покончить с прокрастинацией», «умереть от смеха», «I won't…».
- **[RU]** Заголовок заметки вроде «забудь всё» больше не блокирует разбор этой заметки в диалоге.
- **[EN]** A note title like «forget everything» no longer blocks discussing that note in the dialogue.
- **[RU]** Удаление заметки, которая ни разу не уходила в облако, больше не пугает сообщением «ИИ-данные остались в облаке»; «убрать копию с устройства» больше не удаляет облачные разборы этой заметки.
- **[EN]** Deleting a note that never reached the cloud no longer warns that «AI data remained in the cloud»; «remove the device copy» no longer deletes that note’s analyses in the cloud.
- **[RU]** Разборы ИИ удалённой заметки не могут попасть на сервер задним числом; разборы заметки, отвязанной от облака, остаются на устройстве, а не повторяют отправку бесконечно.
- **[EN]** AI analyses of a deleted note can no longer reach the server afterwards; analyses of a note unlinked from the cloud stay on the device instead of retrying forever.
- **[RU]** Даты в диагностике всегда следуют языку интерфейса.
- **[EN]** Dates in diagnostics always follow the interface language.

## 0.9.25 — 2026-09-30

- **[RU]** Кнопка «Посмотри в других моих записях — как это связано?» больше не прикрепляет к вопросу случайную заметку: приложение само заметки не прикрепляет, это делает только человек.
- **[EN]** The «Look in my other entries — how is it connected?» button no longer attaches a random note to the question: the app never attaches notes on its own, only the person does.

## 0.9.24 — 2026-09-30

- **[RU]** Ссылка ИИ на заметку, номер которой модель сократила многоточием, снова открывается как ссылка, а не печатается сырым текстом.
- **[EN]** An AI reference to a note whose id the model shortened with an ellipsis opens as a link again instead of printing as raw text.
- **[RU]** Кризисная панель в чате появляется и тогда, когда фраза написана с невидимыми символами вместо пробелов, латинскими буквами-двойниками, по-английски или транслитом; на «I don't want to…» и «ne hochu umeret» она не срабатывает. В английском интерфейсе — те же российские номера помощи, что знает ИИ, и строка findahelpline.com для тех, кто не в России.
- **[EN]** The crisis panel in the chat also appears when a phrase is written with invisible characters instead of spaces, Latin look-alike letters, in English or in transliteration; it does not fire on «I don't want to…» or «ne hochu umeret». The English interface shows the same Russian help lines the AI knows, plus findahelpline.com for those outside Russia.
- **[RU]** Фраза вроде «забудь всё» в ответе ИИ больше не ломает диалог навсегда общей ошибкой — проверка на подмену инструкций смотрит только на последнее сообщение человека.
- **[EN]** A phrase like «forget everything» in an AI reply no longer breaks the dialogue for good with a generic error — the instruction-injection check looks only at the person’s latest message.
- **[RU]** Текст удалённой заметки больше не может остаться на сервере: если удаление совпало с выгрузкой из другой вкладки, сервер отказывает в записи версии удалённой заметки.
- **[EN]** A deleted note’s text can no longer stay on the server: if the delete coincided with an upload from another tab, the server refuses to store a version of the deleted note.
- **[RU]** Удаление записи ИИ не теряется, если в тот же момент пришёл запоздалый ответ модели; удалённый разбор и разбор скрытой от ИИ заметки не возвращаются при восстановлении из облака.
- **[EN]** Deleting an AI record is not lost when a late model reply arrives at the same moment; a deleted analysis, or one of a note hidden from AI, does not come back on a restore from the cloud.
- **[RU]** Индикатор синхронизации не говорит «всё в облаке», пока не посчитал; записи ИИ, которые слишком велики для облака или не читаются, больше не выглядят синхронизированными.
- **[EN]** The sync indicator does not say «everything is in the cloud» before it has counted; AI records too large for the cloud or unreadable no longer look synced.
- **[RU]** Письма о входе, смене пароля и приглашении — на русском и английском; строки «введите код вручную», для которого в приложении нет поля, больше нет.
- **[EN]** Sign-in, password reset and invitation emails are in Russian and English; the «enter the code manually» line, which had no field in the app, is gone.
- **[RU]** Руководство на сайте описывает текущий архив и окно завершения записи.
- **[EN]** The on-site guide describes the current archive and the finish window.
- **[RU]** Сервер больше не перенаправляет на чужой домен и не называет свою версию; проверка после выкатки следит за этим.
- **[EN]** The server no longer redirects to a foreign domain or reveals its version; the post-deploy check watches for it.

## 0.9.23 — 2026-09-30

- **[RU]** Архив снова показывает состояние заметки с первого взгляда: цветная полоса метки, фиолетовые значки «на устройстве», «в облаке» и «разобрано ИИ»; жёлтое облако — есть неотправленные изменения. Нажатие на значок делает действие сразу — например, отправляет заметку в облако.
- **[EN]** The archive shows a note’s state at a glance again: a coloured label stripe and violet «on device», «in the cloud» and «analysed by AI» icons; a yellow cloud means unsent changes. Clicking an icon acts right away — for example, sends the note to the cloud.
- **[RU]** Карточки в сетке получили те же значки и меню «⋯»; меню заметки стало компактнее — метки выбираются цветными кружками в одну строку; «+ тег» виден без наведения.
- **[EN]** Grid cards get the same icons and the «⋯» menu; the note menu is more compact — labels are picked from one row of colour dots; «+ tag» is visible without hovering.
- **[RU]** Добавление тега или смена заголовка у старой заметки, созданной до включения шифрования, больше не делает её нечитаемой («Не удалось прочитать»).
- **[EN]** Adding a tag or renaming an old note created before encryption was turned on no longer makes it unreadable («Could not read»).
- **[RU]** В настройках синхронизации можно сравнить, сколько ИИ-данных (разборы, поисковые векторы, записи) лежит на устройстве и сколько в облаке.
- **[EN]** Sync settings can compare how much AI data (analyses, search vectors, records) is on the device and how much is in the cloud.

## 0.9.22 — 2026-09-30

- **[RU]** Сохранение — тихая иконка дискеты в панели кнопок справа внизу: на записи она плавно загорается фиолетовым и гаснет, время последнего сохранения — в подсказке. Мигающих надписей «Сохранение… / Сохранено» больше нет; ошибка сохранения по-прежнему видна сразу, даже в дзене.
- **[EN]** Saving is a quiet floppy-disk icon in the bottom-right control panel: it fades to violet while saving and back, and the tooltip shows the last save time. No more flickering «Saving… / Saved» text; a save error is still shown at once, even in zen.
- **[RU]** Скорость письма — просто число и фиолетовая точка, без оценок «медленно/быстро».
- **[EN]** Writing speed is just a number and a violet dot, without «slow/fast» grades.
- **[RU]** У всех полей ввода есть подписи для экранного диктора — включая поля паролей, тегов и поиска.
- **[EN]** Every input field has a label for screen readers, including password, tag and search fields.
- **[RU]** Журнал активности переведён на английский; даты в диагностике следуют языку интерфейса, а не языку системы.
- **[EN]** The activity log is translated to English; dates in diagnostics follow the interface language, not the system one.

## 0.9.21 — 2026-09-30

- **[RU]** Телефоны помощи в чате — один список для интерфейса и для ИИ: первым идёт взрослая горячая линия 8-800-333-44-34, номер 112 подписан как экстренные службы.
- **[EN]** Crisis help lines in the chat come from one list for both the interface and the AI; the Russian panel leads with the adult helpline, and 112 is labelled as emergency services.
- **[RU]** Светлая тема «Тёплый» и «Системная» при светлой системе больше не мигают тёмным фоном при открытии приложения.
- **[EN]** The light «Warm» theme and «System» on a light system no longer flash a dark background when the app opens.

## 0.9.20 — 2026-09-30

- **[RU]** Заметка, связанная со старой версией приложения, больше не объявляется синхронизированной, если её текст расходится с облаком: облачный текст ложится сверху, а локальная правка остаётся в истории.
- **[EN]** A note linked by an older app version is no longer declared synced when its text differs from the cloud: the cloud text goes on top, and the local edit stays in history.
- **[RU]** Записи ИИ уходят в облако одной транзакцией: запись больше 4 МБ остаётся на устройстве с отметкой, а не выгружается частями.
- **[EN]** AI records go to the cloud in one transaction: a record over 4 MB stays on the device, marked, instead of being uploaded in parts.
- **[RU]** «Отправить всё» больше не удаляет в облаке запись ИИ, которую само же выгрузило; портрет, собранный до удаления заметки, не возвращается после него.
- **[EN]** «Send everything» no longer deletes in the cloud an AI record it has just uploaded; a portrait built before a note was deleted no longer comes back after it.
- **[RU]** После смены аккаунта индикатор синхронизации ни на мгновение не показывает счётчики прошлого аккаунта.
- **[EN]** After switching accounts, the sync indicator never shows the previous account’s counts, even for a moment.

## 0.9.19 — 2026-09-30

- **[RU]** Панель с телефонами помощи снова появляется в чате при острых формулировках — в 0.9.18 её обещали, но интерфейс её не показывал. Детектор ловит больше формулировок («раньше думал…, а сейчас…», невидимые символы, «ё») и не срабатывает на слова вроде «порядок».
- **[EN]** The panel with crisis help lines shows up in the chat again on acute wording — 0.9.18 promised it, but the interface never displayed it. The detector catches more phrasings (a later acute phrase after a past-tense one, invisible characters, «ё») and no longer fires on words like «порядок».
- **[RU]** Заметка, скрытая от ИИ, больше не уходит модели через память диалога и историю сообщений.
- **[EN]** A note hidden from the AI no longer reaches the model through dialogue memory or message history.
- **[RU]** Разбор заметки в чате: новый диалог не наследует заметку из прошлого; «Ответить иначе» опирается на вопрос, а не на текст заметки; обычная фраза в заметке («забудь всё») больше не блокирует диалог; дата заметки без сессий берётся из заметки.
- **[EN]** Note analysis in the chat: a new dialogue no longer inherits the previous note; «Answer differently» works from the question, not the note text; an ordinary phrase in the note («forget everything») no longer blocks the dialogue; a note with no sessions gets its own date.
- **[RU]** ИИ-панель мобильного редактора снова получает текст — все её действия были выключены. Мобильная раскладка пока выключена, на телефоне открывается обычный редактор.
- **[EN]** The AI panel of the mobile editor gets the text again — all its actions were disabled. The mobile layout itself is still switched off; phones get the regular editor.
- **[RU]** Ошибка сохранения больше не исчезает через секунду, а правка, сделанная во время сохранения, сохраняется сразу за ним, а не при следующем нажатии.
- **[EN]** A save error no longer disappears after a second, and an edit made during a save is saved right after it instead of on the next keystroke.
- **[RU]** Эмодзи в больших записях ИИ больше не портятся в облачной копии.
- **[EN]** Emoji in large AI records are no longer corrupted in the cloud copy.
- **[RU]** Удаление заметки больше не снимает блокировку её выгрузки в другой вкладке.
- **[EN]** Deleting a note no longer releases the upload lock held by another tab.
- **[RU]** Индикатор синхронизации показывает паузу, когда выгрузка ИИ-данных остановлена, и не показывает счётчики прошлого аккаунта после смены.
- **[EN]** The sync indicator shows a pause when AI-data uploads are stopped, and no longer shows the previous account’s counts after switching.
- **[RU]** Подписи «2 диалога», «2 заметки» согласованы с числом.
- **[EN]** Labels like «2 dialogues», «2 notes» agree with the number.

## 0.9.18 — 2026-09-29

- **[RU]** Разбор приложенной заметки в чате опирается только на неё: ИИ больше не выдаёт цитаты из других записей за её текст и называет правильную дату.
- **[EN]** Analysing an attached note in the chat uses only that note: the AI no longer passes quotes from other entries off as its text, and it gets the date right.
- **[RU]** Если приложить заметку без вопроса, приложение спросит, что с ней сделать: разобрать или связать с другими записями. После разбора можно одним нажатием посмотреть в других записях.
- **[EN]** Attach a note without a question and the app asks what to do: analyse it or relate it to other entries. After an analysis, one tap looks in other entries.
- **[RU]** Чат снова предлагает контакты службы поддержки, когда в тексте прямо сказано, что человек не хочет жить.
- **[EN]** The chat again offers crisis support contacts when a message says plainly that the person does not want to live.
- **[RU]** Большие диалоги с ИИ больше не отказываются восстанавливаться на другом устройстве, если чтение совпало с их выгрузкой.
- **[EN]** Large AI dialogues no longer refuse to restore on another device when the read lands in the middle of their upload.
- **[RU]** Удаление, которое не выполнилось, потому что заметка ещё выгружается, больше не выдаётся за выполненное: заметка остаётся в списке, а приложение просит попробовать через минуту.
- **[EN]** A delete that did not happen because the note is still uploading is no longer reported as done: the note stays in the list and the app asks to try again in a minute.
- **[RU]** Повреждённый журнал удалений ИИ-данных восстанавливается сам и больше не останавливает их синхронизацию.
- **[EN]** A corrupted journal of AI-data deletions now repairs itself instead of stopping their sync.
- **[RU]** Письмо: режим «Писать без цифр» прячет счётчики; статус сохранения всегда виден внизу экрана, в том числе в дзене.
- **[EN]** Writing: «Write without numbers» hides the counters; the save status is always visible at the bottom of the screen, zen mode included.
- **[RU]** Письмо: скорость подписана словом, а не только цветом; дзен не сдвигает текст; итоги сессии — одна строка и настроение в том же шаге, есть «Сохраню позже»; начало сессии без вспышки на весь экран.
- **[EN]** Writing: speed is labelled with a word, not only a colour; zen no longer shifts the text; the session summary is one line with the mood in the same step, plus «Save later»; starting a session no longer flashes the whole screen.
- **[RU]** Архив: в строке заметки сначала заголовок, все действия — в меню «⋯» (и по правому клику); подписи счётчиков согласованы с числом; пустой архив не показывает «0 дней подряд»; без тегов нет плашки «+ тег»; зона импорта без прыгающей иконки.
- **[EN]** Archive: a note row leads with the title and keeps every action in the «⋯» menu (right click too); counter labels agree with the number; an empty archive no longer shows «0 days in a row»; notes without tags no longer show a «+ tag» chip; the import zone has no bouncing icon.
- **[RU]** Тексты без жаргона; кнопки-переключатели сообщают своё состояние экранному диктору; стрелки календаря подписаны.
- **[EN]** Plain wording instead of jargon; toggle buttons announce their state to screen readers; calendar arrows are labelled.
- **[RU]** В меню вложений чата убран пункт «Загрузить файл».
- **[EN]** The «Upload file» item is removed from the chat attach menu.

## 0.9.17 — 2026-09-29

- **[RU]** Запись ИИ, которую вернули после удаления (или которая снова появилась), больше не стирается в облаке следующей синхронизацией.
- **[EN]** An AI record that came back after a delete is no longer erased from the cloud by the next sync.
- **[RU]** Удаление заметки больше не обгоняет её выгрузку: раньше через 10 секунд ожидания заметка удалялась в обход блокировки и возвращалась из облака.
- **[EN]** Deleting a note no longer races its upload: after a 10-second wait it used to bypass the lock and the note came back from the cloud.
- **[RU]** Сейф, созданный до усиления шифрования, теперь перешифровывается и при обычном входе по паролю, а не только при ручной разблокировке.
- **[EN]** A vault created before the stronger key derivation is now re-wrapped on a regular password sign-in too, not only on manual unlock.
- **[RU]** Счётчик неотправленного показывает только задачи текущего аккаунта и не ошибается на единицу, если сохранение пришлось на середину подсчёта.
- **[EN]** The unsent counter shows only this account’s tasks and is no longer off by one when a save lands mid-count.
- **[RU]** Если облачную версию заметки не удалось прочитать при сверке, это попадает в журнал событий, а не проходит молча.
- **[EN]** A cloud version that cannot be read during reconcile is now written to the activity log instead of passing silently.
- **[RU]** Приложение больше не остаётся на пустом экране, если часть текстов интерфейса грузится слишком долго.
- **[EN]** The app no longer stays on a blank screen when part of the interface text takes too long to load.
- **[RU]** Уведомления о выходе из аккаунта и этапы восстановления из облака переведены на английский.
- **[EN]** Sign-out notices and restore-from-cloud stages are now translated to English.

## 0.9.16 — 2026-09-29

- **[RU]** Нижнее меню на телефоне снова подсвечивает текущую вкладку при переходах.
- **[EN]** The phone’s bottom tab bar highlights the current tab again when you navigate.
- **[RU]** Интерфейс переведён на английский целиком: диалоги восстановления и приглашения, настройки, панель ИИ и экраны диагностики больше не показывают русский текст при английском языке.
- **[EN]** The whole interface is now translated to English: restore and invite dialogs, settings, the AI panel and diagnostics no longer show Russian text when English is selected.
- **[RU]** Приложение стартует быстрее при обновлениях: React вынесен в отдельный файл, который браузер держит в кэше между выпусками.
- **[EN]** The app starts faster after updates: React ships in its own file that the browser keeps cached between releases.
- **[RU]** Обновлены зависимости (React 19.3 и другие минорные и патч-версии).
- **[EN]** Dependencies updated (React 19.3 and other minor and patch releases).

## 0.9.15 — 2026-09-28

- **[RU]** Правка, сделанная пока предыдущая версия уезжала в облако, или заметка, у которой потерялась задача синхронизации, больше не остаются невыгруженными: сверка с облаком не сбрасывает счётчики заметки, пока на устройстве есть невыгруженное.
- **[EN]** An edit made while the previous version was uploading, or a note whose sync task got lost, is no longer left un-uploaded: reconciling with the cloud never resets a note’s counters while the device holds an un-uploaded change.
- **[RU]** Удалённое не возвращается: заметка, у которой не удалось прочитать связь с облаком, итог удалённого диалога с ИИ и удалённый разбор заметки больше не воскресают после синхронизации.
- **[EN]** Deleted things stay deleted: a note whose cloud link could not be read, the closing summary of a deleted AI dialogue and a deleted note analysis no longer come back after sync.
- **[RU]** Разбор заметки ИИ больше не возвращает её из корзины и не откатывает счётчик версий, если заметку меняли во время разбора.
- **[EN]** A note analysis no longer takes the note out of the trash or rolls back its version counter when the note changed during the analysis.
- **[RU]** Чат с ИИ: «ответить иначе» не дублирует вопрос; остановленный ответ помечен как недописанный; при обрыве потока показанный текст сохраняется без второго списания; в контекст попадают самые релевантные заметки, а прикреплённая заметка не теряется в режиме сравнения периодов.
- **[EN]** AI chat: “answer differently” no longer duplicates the question; a stopped answer is marked unfinished; when the stream breaks, the shown text is kept without a second charge; the most relevant notes make it into the context, and an attached note is kept in period-comparison mode.
- **[RU]** Согласие на обработку данных, выход из аккаунта и сброс пароля переведены на английский.
- **[EN]** The data-processing consent, sign-out and password-reset screens are now available in English.
- **[RU]** Сейф, созданный до повышения стойкости пароля, при разблокировке переводится на 600 000 итераций — как обещано в описании безопасности.
- **[EN]** A vault created before the password-hardening raise is upgraded to 600 000 iterations on unlock, as the security notes promise.
- **[RU]** Если не загрузился один из языковых файлов, приложение больше не остаётся белым экраном: оно открывается и догружает переводы.
- **[EN]** If one language file fails to load, the app no longer stays a white screen: it opens and fetches the translations later.
- **[RU]** Мелкое в интерфейсе: Escape закрывает верхнее окно, а не нижнее; второй диалог не подвешивает первый; окно восстановления показывает «…» и ошибку вместо «0 в облаке»; виджет настроения сообщает об ошибке чтения; диктовка не запускает два движка подряд.
- **[EN]** Small UI fixes: Escape closes the top dialog, not the bottom one; a second dialog no longer hangs the first; the restore window shows “…” and an error instead of “0 in the cloud”; the mood widget reports a read error; dictation no longer starts two engines at once.
- **[RU]** Длинный диалог с ИИ, ставший короче, больше не блокирует своё восстановление на другом устройстве.
- **[EN]** A long AI dialogue that became shorter no longer blocks its own restore on another device.

## 0.9.14 — 2026-09-27

- **[RU]** Удалённая заметка больше не возвращается, если вкладку закрыли, пока облако ещё не ответило: удаление запоминается вместе с локальным.
- **[EN]** A deleted note no longer comes back if the tab was closed before the cloud answered: the deletion is remembered together with the local one.
- **[RU]** Правка, сохранённая, пока предыдущая версия уезжала в облако, больше не теряется.
- **[EN]** An edit saved while the previous version was uploading is no longer lost.
- **[RU]** Диалоги и разборы ИИ, ждущие выгрузки, переживают закрытие вкладки; то, что облако отвергло, видно в статусе синхронизации и в настройках, а не пропадает молча.
- **[EN]** AI dialogues and analyses waiting for upload survive closing the tab; what the cloud rejected is shown in the sync status and settings instead of vanishing silently.
- **[RU]** Чат: ваш вопрос остаётся в диалоге, если ответ оборвался на середине.
- **[EN]** Chat: your question stays in the dialogue if the answer breaks off midway.
- **[RU]** Запрос к ИИ больше не висит бесконечно: через 130 секунд он обрывается с понятной ошибкой, а уход со страницы его отменяет.
- **[EN]** An AI request no longer hangs forever: it is cut off after 130 seconds with a clear error, and leaving the page cancels it.
- **[RU]** Счётчик запросов к ИИ говорит «неизвестно», если сервер не смог прочитать лимиты, а не показывает прошлое число.
- **[EN]** The AI request counter says "unknown" when the server could not read the limits instead of showing an old number.
- **[RU]** Сбой чтения профиля больше не перезаписывает ник; приложение, открытое без сети, подхватывает профиль, когда сеть вернулась.
- **[EN]** A failed profile read no longer overwrites the nickname; an app opened offline picks up the profile once the network is back.
- **[RU]** Без сети и без сохранённой копии приложение показывает страницу «Нет сети» вместо системной ошибки браузера.
- **[EN]** Offline with nothing cached, the app shows a "No connection" page instead of the browser error.
- **[RU]** Сервер: десяток одновременных запросов к ИИ больше не может повесить весь сервис.
- **[EN]** Server: a dozen simultaneous AI requests can no longer hang the whole service.
- **[RU]** Подписи у полей, фокус и Escape в диалогах, контраст текста.
- **[EN]** Field labels, focus and Escape in dialogs, text contrast.

## 0.9.13 — 2026-09-27

- **[RU]** Запертый сейф — видимое состояние: пока сейф включён и заперт, наверху плашка «Сейф заперт — синхронизация на паузе» с кнопкой «Открыть сейф». Отложенное ждёт ключа без попыток и карантина и после открытия сейфа уходит само.
- **[EN]** A locked vault is a visible state: a banner "Vault is locked — sync is paused" with an "Open vault" button. Pending work waits for the key without retries or quarantine and leaves on its own once the vault is opened.
- **[RU]** Ссылка-приглашение при открытом аккаунте: мастер больше не открывается прежнему аккаунту, после обновления страницы возвращается мастер, а не форма восстановления, и ссылка не объявляется устаревшей по ошибке.
- **[EN]** Invite link over an open account: the wizard is no longer shown to the previous account, a page reload returns to the wizard rather than the recovery form, and the link is no longer wrongly declared expired.
- **[RU]** Безопасность: при повторной записи версии после коллизии номеров настроение больше не уходит в облако открытым текстом.
- **[EN]** Security: retrying a version write after a number collision no longer sends the mood to the cloud in plain text.
- **[RU]** Ручная синхронизация очереди при запертом сейфе говорит, что сейф заперт, а не «очередь пуста».
- **[EN]** Manual queue sync with a locked vault says the vault is locked, not "queue is empty".
- **[RU]** Плашка состояния соединения больше не рисуется дважды одна поверх другой.
- **[EN]** The connection status banner is no longer drawn twice on top of itself.
- **[RU]** При входе гостевые заметки переносятся в аккаунт без копии в гостевой базе браузера — гостевое удаляется только после подтверждённой записи в аккаунт.
- **[EN]** On sign-in, guest notes move into the account without a leftover copy in the guest database — guest data is removed only after the account write is confirmed.
- **[RU]** Дата в истории жизни не съезжает на день в часовых поясах западнее Гринвича.
- **[EN]** Life-story dates no longer shift by a day in time zones west of Greenwich.

## 0.9.12 — 2026-09-26

- **[RU]** Смена аккаунта во вкладке — выход, вход под другим, ссылка из письма, то же в соседней вкладке — перезагружает страницу: новый человек начинает с чистой памяти, и ничего от прежнего аккаунта на экран и в его данные не попадает. Текст из редактора перед этим сохраняется прежнему владельцу.
- **[EN]** Changing the account in a tab — signing out, signing in as someone else, an email link, the same in another tab — reloads the page: the new person starts from clean memory and nothing of the previous account reaches their screen or data. The editor text is saved for its owner first.
- **[RU]** Фоновая синхронизация, начатая для одного аккаунта, больше не может записать его заметки в базу другого аккаунта или гостя.
- **[EN]** Background sync started for one account can no longer write its notes into another account’s or the guest database.
- **[RU]** Удаление, корзина и восстановление больше не отвечают «в облаке тоже», если облако не тронуто: удалённая заметка не возвращается следующей загрузкой.
- **[EN]** Delete, trash and restore no longer answer "done in the cloud too" when the cloud was not touched: a deleted note no longer comes back with the next download.
- **[RU]** Журнал ошибок — по-русски: запертый сейф так и назван («Возможно, сейф заблокирован»), технический текст для разработчика остаётся в подробностях.
- **[EN]** The error log speaks Russian: a locked vault is named as such, the technical text for the developer stays in the details.
- **[RU]** Метки «…» в окне заметки объясняют: сейф заперт, откройте его, чтобы увидеть названия.
- **[EN]** Labels shown as "…" in the note window explain that the vault is locked.

## 0.9.11 — 2026-09-26

- **[RU]** Текст в редакторе привязан к своему аккаунту и после перехода на страницу приглашения или входа под другим аккаунтом: чужой текст сохраняется прежнему владельцу и никогда — новому.
- **[EN]** Editor text stays bound to its account even after moving to the invite page or signing in as someone else: it is saved for its owner, never for the new account.
- **[RU]** Удаление больше не сообщает об успехе, которого не было: «корзина очищена» — только если очищена, неудалённое остаётся видно, а при удалении навсегда сказано, если разборы ИИ удалить не удалось.
- **[EN]** Deleting no longer reports success it did not have: "trash emptied" only when it is, what failed stays visible, and a permanent delete says when AI analyses could not be removed.
- **[RU]** В светлой теме основные кнопки теперь читаемы, а белый текст на фиолетовых кнопках в тёмных темах заменён на контрастный.
- **[EN]** Primary buttons are readable in the light theme, and white text on purple buttons in dark themes is replaced with a contrasting colour.
- **[RU]** Доступность: вопрос о смене аккаунта объявляется скринридером как диалог, поля пароля подписаны, ошибки зачитываются.
- **[EN]** Accessibility: the account-switch question is announced as a dialog, password fields are labelled, errors are read out.
- **[RU]** Синхронизация не выгружает повторно уже выгруженные заметки, если запись счётчика попыток дала сбой.
- **[EN]** Sync no longer re-uploads finished notes when writing the retry counter fails.
- **[RU]** Метки заметок больше не застревают на «…» после неудачного чтения профиля.
- **[EN]** Note labels no longer get stuck at "…" after a failed profile read.
- **[RU]** Ссылка из письма обрабатывается один раз и после перезагрузки страницы не показывает «ссылка устарела» и не спрашивает повторно о смене аккаунта.
- **[EN]** An email link is exchanged once: a page reload no longer shows "link expired" or asks about switching accounts again.

## 0.9.10 — 2026-09-26

- **[RU]** Если сервер не отвечает, а интернет есть, сверху появляется подсказка: «Нет связи с сервером. Если включён VPN, попробуйте без него». То же сказано в ошибках входа и открытия сейфа.
- **[EN]** If the server does not answer while the internet is up, a banner says so and suggests trying without a VPN. Sign-in and vault errors say the same.
- **[RU]** Сбой сети больше не перезагружает страницу посреди письма: перезагрузка — только если после выкатки части приложения действительно нет на сервере.
- **[EN]** A network hiccup no longer reloads the page mid-writing: it reloads only when part of the app is really gone from the server after an update.
- **[RU]** При смене аккаунта черновик прежнего аккаунта стирается с экрана только после того, как он действительно записан; пропущенная запись больше не показывается как «Сохранено».
- **[EN]** When the account changes, the previous account’s draft leaves the screen only after it is really written; a skipped write no longer shows as "Saved".
- **[RU]** Страница приглашения, не сумевшая проверить текущий вход, спрашивает, а не меняет аккаунт молча.
- **[EN]** The invite page asks instead of switching accounts silently when it cannot check the current sign-in.
- **[RU]** Вопрос о синхронизации, закрытый клавишей Esc или кликом мимо окна, не считается ответом «нет» — его зададут снова.
- **[EN]** Closing the sync question with Esc or a click outside is not an answer "no" — it will be asked again.
- **[RU]** Переключатель синхронизации в настройках сразу показывает изменение, сделанное в другом месте.
- **[EN]** The sync switch in settings reflects a change made elsewhere right away.
- **[RU]** Безопасность: профиль, курсор синхронизации и восстановление ИИ-данных принимают из облака только строки своего аккаунта.
- **[EN]** Security: the profile, the sync cursor and the AI data restore accept only the account’s own rows from the cloud.
- **[RU]** Журнал больше не пишет ложные «сессия неожиданно завершена» после выхода в соседней вкладке и «возможная задержка редактора» по ритму набора.
- **[EN]** The journal no longer logs false "session ended unexpectedly" after signing out in another tab, or "possible editor lag" from typing rhythm.

## 0.9.9 — 2026-09-25

- **[RU]** Черновик остаётся в своём аккаунте: если аккаунт сменился при открытом редакторе, текст сохраняется прежнему владельцу, а не попадает черновиком в новый аккаунт.
- **[EN]** A draft stays with its account: if the account changes while the editor is open, the text is saved for its owner instead of ending up as the new account’s draft.
- **[RU]** Ссылка-приглашение, открытая при уже выполненном входе, сначала спрашивает, выходить ли из текущего аккаунта.
- **[EN]** An invite link opened while you are signed in now asks before signing you out of the current account.

## 0.9.8 — 2026-09-25

- **[RU]** Заметка, которую сервер подтвердил, но потерял, снова уходит в облако, а не считается синхронизированной навсегда.
- **[EN]** A note the server acknowledged but then lost is uploaded again instead of counting as synced forever.
- **[RU]** Безопасность: приложение берёт из облака только строки своего аккаунта, даже если сервер по ошибке отдал чужие.
- **[EN]** Security: the app takes only its own account’s rows from the cloud, even if the server hands over someone else’s by mistake.

## 0.9.7 — 2026-09-25

- **[RU]** После мастера приглашения больше не всплывают второй раз окно политики и вопрос о синхронизации — мастер уже спросил об этом.
- **[EN]** After the invite wizard, the privacy window and the cloud-sync question no longer pop up a second time — the wizard has already asked.
- **[RU]** Включённая синхронизация сразу видна: статус больше не пишет «автоотправка выключена» рядом с включённым переключателем.
- **[EN]** Turning cloud sync on shows at once: the status no longer says "auto-upload is off" next to a switched-on toggle.
- **[RU]** Согласие на функции ИИ — обычная галочка под обязательной, без отдельной карточки.
- **[EN]** The AI consent is now a plain checkbox under the required one, without a separate card.
- **[RU]** Если в соседней вкладке вошли под другим аккаунтом, фоновая вкладка перезагружается, а не продолжает работать за прежний аккаунт.
- **[EN]** If another tab signs in to a different account, a background tab reloads instead of carrying on as the previous account.

## 0.9.6 — 2026-09-25

- **[RU]** «PDF / печать» снова работает — и на экране письма, и при выгрузке архива.
- **[EN]** "PDF / print" works again, both on the writing screen and in the archive export.
- **[RU]** Если скрыть заметку от ИИ или удалить её, из памяти ИИ уходит и всё, что из неё извлечено: хронология, планы, темы, история жизни и убеждения, — и в чат это больше не попадает.
- **[EN]** Hiding a note from the AI or deleting it now also removes everything drawn from it — timeline, plans, themes, life story and beliefs — and none of it reaches the chat any more.
- **[RU]** «Удалить все данные ИИ» стирает и сохранённый портрет, и он больше не возвращается в подсказки чата.
- **[EN]** "Delete all AI data" now also clears the saved portrait, so it no longer comes back in chat hints.
- **[RU]** Удаление аккаунта теперь удаляет и обезличенную статистику.
- **[EN]** Deleting your account now also deletes its anonymised statistics.
- **[RU]** Приложение с экрана «Домой» на iPhone больше не стоит белым, пока загружается.
- **[EN]** The home-screen app on iPhone no longer shows a white screen while it loads.
- **[RU]** Дата в ссылке на заметку в чате — по вашему местному времени.
- **[EN]** The date on a note link in the chat now uses your local time.
- **[RU]** Синхронизация: время изменения новой заметки ставит сервер, а счётчик сессий не пишется в удалённую заметку.
- **[EN]** Sync: the server now stamps when a new note was changed, and the session counter no longer writes to a deleted note.

## 0.9.5 — 2026-09-25

- **[RU]** Приглашение открывает короткий мастер: приветствие, согласие с политикой, пароль и выбор — хранить ли заметки в облаке. После него сразу редактор, без окон поверх.
- **[EN]** An invite link now opens a short wizard: welcome, privacy consent, password and whether to keep notes in the cloud. Then straight to the editor, with nothing popping up on top.
- **[RU]** Стартовое окно «Сколько хочешь писать?» убрано — оно больше не мелькает при открытии приложения.
- **[EN]** The "How much do you want to write?" start screen is gone, so it no longer flashes when the app opens.

## 0.9.4 — 2026-09-25

- **[RU]** Корзина и восстановление из неё, сделанные без связи, теперь доходят до облака и других устройств.
- **[EN]** Moving a note to the trash or restoring it while offline now reaches the cloud and your other devices.
- **[RU]** Если заметку положили в корзину на одном устройстве, а на другом в неё дописали, свежая правка возвращает заметку из корзины на обоих устройствах, а журнал сообщает об этом.
- **[EN]** If a note was trashed on one device and edited on another, the new edit brings it back from the trash on both devices, and the journal says so.
- **[RU]** Копия, которая создаётся при конфликте правок на двух устройствах, больше не путает версии: в облако уходят все тексты, последней показывается последняя правка, а история оригинала не смешивается с копией.
- **[EN]** The copy made during an edit conflict between two devices no longer mixes up versions: every text reaches the cloud, the latest edit shows as latest, and the original's history is not mixed with the copy.
- **[RU]** Правка с другого устройства после конфликта больше не теряется из виду.
- **[EN]** An edit from another device after a conflict no longer goes unseen.
- **[RU]** Безопасность: при включённом шифровании приложение не принимает из облака незашифрованные записи — подложить заметку или запись памяти ИИ нельзя.
- **[EN]** Security: with encryption on, the app no longer accepts unencrypted records from the cloud, so a note or AI memory entry cannot be planted.
- **[RU]** «Зашифровать все заметки» теперь дошифровывает и отпечаток текста в старых разборах.
- **[EN]** "Encrypt all notes" now also encrypts the text fingerprint in older analyses.

## 0.9.3 — 2026-09-24

- **[RU]** Заметка, отправленная в корзину или восстановленная из неё на одном устройстве, теперь так же оказывается в корзине или возвращается на другом.
- **[EN]** A note moved to the trash or restored on one device now does the same on your other devices.
- **[RU]** Восстановление из резервной копии больше не оживляет заметки из корзины.
- **[EN]** Restoring a backup no longer brings trashed notes back to life.
- **[RU]** Если при конфликте правок создаётся копия заметки, в ней теперь верные итоги слов и времени, а счётчики профиля не сбиваются.
- **[EN]** When an edit conflict creates a copy of a note, the copy now has the right word and time totals, and profile counters stay correct.
- **[RU]** День заметки для разборов ИИ, таймлайна и истории жизни теперь считается по вашему времени, а не по Гринвичу: запись после полуночи больше не попадает во «вчера».
- **[EN]** A note's day in AI analysis, the timeline and the life story now follows your local time rather than UTC: writing after midnight no longer lands on "yesterday".
- **[RU]** Кнопка «Заблокировать» закрывает сейф во всех открытых вкладках, а не только в текущей.
- **[EN]** The Lock button now closes the vault in every open tab, not just the current one.
- **[RU]** Приватность: темы и названия сфер из дневника больше не попадают в журнал активности; одноразовые ссылки из писем не записываются в журнал сервера; отметку времени согласия ставит только сервер.
- **[EN]** Privacy: themes and domain names from your diary no longer end up in the activity log; one-time links from e-mails are not written to the server log; only the server records when consent was given.
- **[RU]** Переименование и удаление тега работают и на архивах больше тысячи заметок, а сбой больше не выдаётся за успех.
- **[EN]** Renaming and deleting a tag now work on archives over a thousand notes, and a failure is no longer reported as success.
- **[RU]** Импорт заметок из файлов считает слова так же, как всё приложение.
- **[EN]** Importing notes from files counts words the same way as the rest of the app.

## 0.9.2 — 2026-09-24

- **[RU]** Перенос архива больше не теряет отметки «не показывать ИИ» и «только на этом устройстве», закреплённые мысли, теги и метку черновика, а импорт либо проходит целиком, либо не меняет ничего.
- **[EN]** Moving the archive no longer loses the "hide from AI" and "this device only" flags, pinned thoughts, tags or the draft label, and an import either completes in full or changes nothing.
- **[RU]** «Сегодня написано N слов» считает только сегодняшнее, а окно завершения при продолжении старой заметки показывает время и скорость этой сессии.
- **[EN]** "Words written today" counts only today, and the finish window shows this session's time and speed when you continue an old note.
- **[RU]** Приложение просит браузер не удалять локальный архив при нехватке места и предупреждает, если место кончилось.
- **[EN]** The app asks the browser not to evict the local archive when space runs low, and warns you when storage is full.
- **[RU]** Если в другой вкладке приложение обновилось, эта вкладка прямо говорит обновить страницу, а не перестаёт сохранять молча.
- **[EN]** When the app updates in another tab, this tab tells you to reload instead of silently stopping to save.
- **[RU]** Обычные фразы в заметке больше не ломают разбор граней и убеждений; длинные заметки ищутся по всему тексту, а не по первой половине.
- **[EN]** Ordinary phrases in a note no longer break the facet and belief analysis; long notes are searchable in full, not just their first half.
- **[RU]** Оборванный на середине ответ ИИ помечается как оборванный.
- **[EN]** An AI reply cut off midway is now marked as cut off.
- **[RU]** Правка названия, тегов или метки, не дошедшая до облака, отправляется при следующей синхронизации; неудавшаяся отправка разбора или чата тоже повторяется.
- **[EN]** A title, tag or label edit that failed to reach the cloud is sent on the next sync; a failed upload of an analysis or chat is retried too.
- **[RU]** Заметка, удалённая на другом устройстве, больше не возвращается молча под прежним номером, а заметка из корзины остаётся в корзине на другом устройстве.
- **[EN]** A note deleted on another device no longer comes back silently, and a note in the trash stays in the trash on your other devices.
- **[RU]** Удаление заметки во время её первой отправки в облако больше не оставляет облачную копию, которая потом возвращалась.
- **[EN]** Deleting a note during its first upload no longer leaves a cloud copy that later came back.
- **[RU]** При первом входе можно отказаться запоминать ключ шифрования на этом устройстве — для чужого или общего компьютера.
- **[EN]** On first sign-in you can choose not to remember the encryption key on this device — for a shared or someone else's computer.
- **[RU]** Приватность: код восстановления больше не хранится в браузере после закрытия вкладки, «стереть всё» чистит и общую базу браузера, отпечаток текста в разборе и настроение версий шифруются.
- **[EN]** Privacy: the recovery code no longer stays in the browser after the tab closes, "erase everything" also clears the shared browser database, and the analysis text fingerprint and version moods are encrypted.

## 0.9.1 — 2026-09-24

- **[RU]** Экран письма стал легче: при наборе и тиканье таймера больше не перерисовывается всё окно целиком, поэтому текст не подтормаживает на длинных заметках.
- **[EN]** The writing screen is lighter: typing and the timer tick no longer re-render the whole window, so long notes no longer lag while you type.
- **[RU]** Разбор заметки, сделанный заново на другом устройстве, теперь заменяет старый, а новые разборы и диалоги появляются на открытом экране без перезагрузки.
- **[EN]** A note analysis redone on another device now replaces the old one, and new analyses and dialogues show up on an open screen without reloading.
- **[RU]** Руководство пользователя открывается прямо в приложении, в его шрифтах и оформлении. Ссылка есть на странице «О приложении», в «Помощи» и в настройках.
- **[EN]** The user guide now opens right inside the app, in its fonts and style. It is linked from the About page, Help and Settings.
- **[RU]** Кратковременная потеря связи (например, когда ноутбук просыпается) больше не показывается в журнале как ошибка — это предупреждение, данные дозагрузятся сами.
- **[EN]** A brief loss of connection (for example, while a laptop wakes up) no longer shows as an error in the journal — it is a warning, and the data catches up on its own.
- **[RU]** Приложение загружается быстрее: редко нужные части подгружаются только когда понадобятся.
- **[EN]** The app starts faster: rarely needed parts load only when they are needed.

## 0.9.0 — 2026-09-23

- **[RU]** Полное руководство пользователя: 9 страниц со скриншотами по адресу /docs — как писать, работать с заметками, разбором ИИ, облаком и паролями. Ссылки — в «Помощи» и в «Настройки → О приложении».
- **[EN]** A full user guide: 9 illustrated pages at /docs — writing, notes, AI analysis, cloud and passwords. Linked from Help and Settings → About.
- **[RU]** Один пароль: пароль входа открывает и заметки. «Сменить пароль» меняет оба сразу, отдельной кнопки для пароля шифрования больше нет. После сброса пароля по почте приложение один раз попросит прежний пароль, и дальше снова один пароль.
- **[EN]** One password: your sign-in password also opens your notes. "Change password" changes both at once; the separate encryption password button is gone. After an e-mail reset the app asks for the previous password once, then it is one password again.
- **[RU]** Сервер больше не получает ваш пароль: при входе браузер отправляет производный от него ключ. Старые аккаунты переходят на это сами при следующем входе.
- **[EN]** The server no longer receives your password: the browser sends a key derived from it. Existing accounts switch over on their next sign-in.
- **[RU]** Выключенная синхронизация теперь значит «в облако не уходит ничего»: ни заметки и черновики, ни разбор ИИ, ни перенос гостевых заметок, ни импорт архива. Кнопки ручной отправки работают как прежде.
- **[EN]** Sync off now means nothing goes to the cloud: no notes or drafts, no AI analysis, no guest-note transfer, no archive import. The manual upload buttons still work.
- **[RU]** Разборы и чаты, сделанные на другом устройстве, приезжают за несколько минут, а не раз в сутки.
- **[EN]** AI analyses and chats made on another device now arrive within minutes instead of once a day.
- **[RU]** Настройка «Память ИИ и подсказки»: можно выключить служебные запросы после ответа в чате (подсказки следующего сообщения и сохранение фактов в память).
- **[EN]** New "AI memory and suggestions" setting: turn off the service requests made after a chat reply (next-message suggestions and saving facts to memory).
- **[RU]** Если сейф при входе не удалось создать, заметки больше не уходят в облако без шифрования — приложение сразу предлагает создать сейф.
- **[EN]** If the vault could not be created at sign-in, notes no longer go to the cloud unencrypted — the app offers to create the vault right away.
- **[RU]** Окно «Разблокировать шифрование» больше не всплывает сразу после входа, когда сейф уже открыт.
- **[EN]** The "Unlock encryption" prompt no longer pops up right after sign-in when the vault is already open.
- **[RU]** Конфликт правок на двух устройствах больше не может потерять локальные версии заметки.
- **[EN]** An edit conflict between two devices can no longer lose local versions of a note.
- **[RU]** Черновик снова сохраняется каждые 30 секунд во время набора; ложное «Найден несохранённый черновик» после «Продолжить писать» без правок убрано.
- **[EN]** The draft is saved every 30 seconds while typing again; the false "Unsaved draft found" after "Continue writing" with no edits is gone.
- **[RU]** Ctrl/⌘+S сохраняет заметку, горячие клавиши работают на русской раскладке, экспорт в PDF больше не пишет про заблокированное окно.
- **[EN]** Ctrl/⌘+S saves the note, shortcuts work on the Russian layout, PDF export no longer reports a blocked pop-up.
- **[RU]** Метки, пришедшие из импорта архива, больше не пропадают после удаления заметки.
- **[EN]** Labels from an archive import no longer disappear after a note is deleted.
- **[RU]** Много исправлений текстов и подписей по итогам сверки интерфейса с руководством.
- **[EN]** Many copy and label fixes found while checking the interface against the guide.

## 0.8.57 — 2026-09-22

- **[RU]** Заметка, сохранённая офлайн или прерванная сбоем сети, теперь точно доходит до облака в фоне — без ожидания следующего визита.
- **[EN]** A note saved offline or interrupted by a network drop now actually reaches the cloud in the background — no need to wait for the next visit.
- **[RU]** Заметка в корзине больше не всплывает в разборе ИИ и в подсказках чата — как в архиве, так и на других устройствах.
- **[EN]** A note in the trash no longer surfaces in AI analysis or chat suggestions.
- **[RU]** Удаление единственной копии заметки (только на устройстве или только в облаке) теперь тоже отправляет её в корзину на 10 дней, а не стирает сразу.
- **[EN]** Deleting a note's only copy (device-only or cloud-only) now also sends it to the 10-day trash instead of erasing it immediately.
- **[RU]** Устаревшая ссылка из письма (приглашение или восстановление пароля) показывает понятное сообщение вместо пустого экрана.
- **[EN]** An outdated link from an email (invite or password reset) now shows a clear message instead of a blank screen.
- **[RU]** Повторное приглашение человека, который ещё не задал пароль, честно говорит «отправлено повторно», а не выглядит как первое приглашение.
- **[EN]** Re-inviting someone who hasn't set a password yet now says "resent", instead of looking like a first invite.
- **[RU]** После смены пароля аккаунта на другом устройстве окно разблокировки подсказывает ввести прежний пароль или код восстановления, а не нынешний.
- **[EN]** After an account password change, the unlock prompt on another device now points at the previous password or recovery code, not the current one.
- **[RU]** Поиск по архиву без результатов больше не показывает лишние фигурные скобки вокруг запроса.
- **[EN]** An empty archive search no longer shows stray curly braces around the query.
- **[RU]** Журнал активности теперь фиксирует восстановление заметки из корзины и удаление отдельной заметки навсегда.
- **[EN]** The activity journal now logs restoring a note from trash and permanently deleting a single note.
- **[RU]** Мобильный вид временно отключён — пока все видят десктопный интерфейс, мобильная версия дорабатывается отдельно.
- **[EN]** Mobile layout is temporarily disabled — everyone sees the desktop interface for now while the mobile version is reworked separately.

## 0.8.56 — 2026-09-22

- **[RU]** Добавлена корзина: удалённая заметка хранится 10 дней и её можно восстановить, есть полное удаление и очистка корзины, оба действия видны в журнале.
- **[EN]** Added a trash bin: a deleted note is kept for 10 days and can be restored; permanent deletion and emptying the trash are both logged.
- **[RU]** В архиве больше не остаются метки с именем «…» — названия подгружаются как надо после разблокировки.
- **[EN]** Labels in the archive no longer get stuck showing "…" — names load correctly after unlocking.
- **[RU]** Облако слов в архиве теперь обновляется вместе с заметками, а не застывает на старом состоянии.
- **[EN]** The archive word cloud now updates along with your notes instead of staying stale.
- **[RU]** Календарь в боковой панели архива больше не обрезается по краю; кнопка «Импорт» пока скрыта.
- **[EN]** The calendar in the archive sidebar no longer gets clipped at the edge; the "Import" button is hidden for now.
- **[RU]** При первой настройке шифрования теперь показывается код восстановления, а окно «Разблокировать шифрование» больше не всплывает без причины на каждом открытии.
- **[EN]** The recovery code is now shown when encryption is first set up, and the "Unlock encryption" prompt no longer appears out of nowhere on every open.
- **[RU]** Заметка, сохранённая офлайн, теперь действительно долетает до облака, как только связь восстанавливается.
- **[EN]** A note saved offline now actually reaches the cloud once the connection comes back.
- **[RU]** На телефоне при написании текста теперь используется мобильный вид экрана — кнопка «Стоп» больше не перекрыта.
- **[EN]** Phones now get the mobile writing layout — the "Stop" button is no longer covered.
- **[RU]** Форма пароля по ссылке-приглашению больше не прячется за экраном согласия; устаревшая или уже использованная ссылка показывает понятное сообщение.
- **[EN]** The password form from an invite link is no longer hidden behind the consent screen; an outdated or already-used link now shows a clear message.
- **[RU]** Сбой у ИИ-провайдера в чате больше не выглядит как ошибка пользователя и не списывает дневной лимит; при исчерпанном лимите видно, когда он обновится.
- **[EN]** An AI provider failure in chat no longer looks like the user's fault and no longer charges the daily quota; when the limit runs out, it now shows when it resets.
- **[RU]** Тост «нужно согласие на ИИ» теперь ведёт прямо в Настройки, а не просто сообщает о проблеме.
- **[EN]** The "AI consent needed" toast now links straight to Settings instead of just reporting the problem.
- **[RU]** Смена пароля офлайн показывает «нет соединения», а не «ссылка устарела».
- **[EN]** Changing your password while offline now shows "no connection" instead of "link expired".
- **[RU]** Строки в архиве показывают начало текста заметки, а не только дату — заметки без заголовка теперь различимы.
- **[EN]** Archive rows now show the start of the note's text, not just the date — untitled notes are distinguishable again.
- **[RU]** Смена пароля аккаунта теперь предупреждает, что это не меняет пароль шифрования заметок, и где взять код восстановления.
- **[EN]** Changing your account password now warns that it doesn't change the notes' encryption password, and where to find the recovery code.

## 0.8.55 — 2026-09-22

- **[RU]** Донастроили вчерашнее исправление конфликтов синхронизации — ещё один редкий случай, где текст мог тихо разойтись между устройством и облаком, теперь тоже обрабатывается верно.
- **[EN]** Tightened yesterday's sync-conflict fix — one more rare case where text could silently diverge between device and cloud is now handled correctly too.

## 0.8.54 — 2026-09-21

- **[RU]** При конфликте синхронизации текст с этого устройства теперь не пропадает, даже если облачная версия повреждена и не может быть прочитана.
- **[EN]** During a sync conflict, text from this device is no longer lost even when the cloud version can't be decrypted.
- **[RU]** Сообщение «удалено полностью» при удалении заметки теперь появляется, только если облачная копия правда удалена, а не просто поставлена в очередь.
- **[EN]** The "deleted completely" message on note deletion now only appears once the cloud copy is actually gone, not just queued.
- **[RU]** Сервер стал устойчивее к обрывам соединения с базой данных — короткий сбой сети больше не должен ронять сервис целиком.
- **[EN]** The server is now more resilient to database connection drops — a brief network blip should no longer take the whole service down.

## 0.8.53 — 2026-09-21

- **[RU]** Поиск по смыслу (векторы заметок) теперь считается прямо на своём сервере, а не сторонним провайдером ИИ — текст заметки для этого больше никуда не уходит.
- **[EN]** Semantic search (note vectors) is now computed on our own server instead of by a third-party AI provider — note text no longer leaves anywhere for this.
- **[RU]** Рядом с номером версии появляется точка, когда вышло обновление — пропадает, как только откроешь журнал изменений.
- **[EN]** A dot appears next to the version number when an update is out — it disappears once you open the changelog.

## 0.8.52 — 2026-09-21

- **[RU]** Ошибки ИИ и синхронизации теперь говорят, что случилось на самом деле: минутное ограничение больше не путается с дневным лимитом, реальный сбой сервиса не подписывается как «попробуй ещё раз» там, где это не поможет, а обновление приложения в фоне показывает «обновите страницу» вместо экрана с кодом ошибки.
- **[EN]** AI and sync errors now say what actually happened: a one-minute rate limit is no longer shown as the daily quota, a genuine service failure isn't labelled "try again" where retrying won't help, and a background app update shows "please reload" instead of a generic crash screen.
- **[RU]** «Стереть всё с этого компьютера» на чужом устройстве теперь честно сообщает, если очистка не удалась, вместо того чтобы молча оставить часть данных.
- **[EN]** "Wipe this computer" on a shared device now reports it honestly if the cleanup fails, instead of silently leaving data behind.

## 0.8.51 — 2026-09-20

- **[RU]** Диалоги с ИИ, анализ заметок и поиск по архиву стали заметно экономичнее по токенам — те же возможности, меньше расхода дневного лимита на служебные детали запроса.
- **[EN]** AI dialogue, note analysis and archive search now use noticeably fewer tokens per call — same capabilities, less of your daily quota spent on request plumbing.

## 0.8.50 — 2026-09-20

- **[RU]** Новый аккаунт перед первой сессией письма видит экран выбора цели — сколько слов писать за раз. Настройки можно поменять позже как обычно.
- **[EN]** A new account sees a goal-picker screen before the first writing session — how many words to aim for. Adjustable later as usual.
- **[RU]** После установки пароля по ссылке-приглашению email больше не нужно вводить заново на экране входа — он уже там.
- **[EN]** After setting a password from an invite link, the email no longer needs to be retyped on the sign-in screen — it's already there.
- **[RU]** Окно согласия при первом входе разбито на понятные разделы, обязательное согласие визуально отделено от необязательного (согласие на ИИ), и в нём теперь явно указано, что голосовой ввод обрабатывается серверами браузера (Google или Apple).
- **[EN]** The first-run consent screen is now split into clear sections, the required consent is visually separated from the optional one (AI features), and it now explicitly names that voice input is processed by the browser vendor's servers (Google or Apple).
- **[RU]** Пустой архив предлагает написать первую заметку одной кнопкой.
- **[EN]** An empty archive offers a one-click "write first note" action.
- **[RU]** Кнопка журнала активности в сайдбаре и в мобильной навигации теперь видна всегда и меняет цвет по статусу фоновой работы — не только при ошибке.
- **[EN]** The activity log button in the sidebar and mobile navigation is now always visible and changes colour with background-work status, not just on error.

## 0.8.49 — 2026-09-19

- **[RU]** Заметки, изменённые на другом устройстве, теперь подтягиваются сами, когда вы возвращаетесь на вкладку — больше не нужно вручную пересохранять, чтобы увидеть свежую версию.
- **[EN]** Notes changed on another device now pull in on their own when you come back to the tab — no more manual re-save to see the latest version.
- **[RU]** Новая настройка «не отправлять портрет в диалог с ИИ». Сам портрет теперь описывает устойчивые черты характера, а не конкретные события, имена и даты — меньше личных деталей уходит модели.
- **[EN]** A new setting to keep the portrait out of the AI dialogue. The portrait itself now describes durable character traits rather than specific events, names and dates — fewer personal details reach the model.
- **[RU]** «Стереть всё с этого компьютера» теперь действительно ничего не оставляет — включая гостевые данные и следы предыдущего аккаунта на общем браузере. Согласие на облачную синхронизацию больше не передаётся между аккаунтами на одном устройстве.
- **[EN]** «Wipe this computer» now genuinely leaves nothing behind — including guest-session data and traces of the previous account on a shared browser. Cloud-sync consent no longer carries over between accounts on the same device.
- **[RU]** Восстановление из облака: если один аккаунт недавно проверял облако на этом браузере, следующий вошедший больше не получает пустой архив из-за общего с ним ограничения частоты запросов.
- **[EN]** Cloud restore: if one account just checked the cloud on this browser, the next account signing in no longer gets an empty archive because of a rate limit it shared with the previous one.

## 0.8.48 — 2026-09-15

- **[RU]** Архив стал нагляднее: на метках и тегах — число заметок за ними, «/» ставит курсор в поиск из любого места, в превью появилась хлебная крошка «‹ Архив / #тег», а календарь превратился в теплокарту — дни закрашены по числу написанных слов, при наведении «3 заметки · 1240 слов».
- **[EN]** The archive got clearer: labels and tags show how many notes are behind them, «/» focuses search from anywhere, the preview gains a breadcrumb «‹ Archive / #tag», and the calendar became a heat map — days shaded by words written, with «3 notes · 1240 words» on hover.
- **[RU]** Кнопка «Скопировать» открывает окно с двумя вкладками — Markdown (с заголовком, датой и тегами) и просто текст: видно, что копируешь, до того как скопировал. Теперь она есть и в архиве, и в мобильном журнале.
- **[EN]** The Copy button opens a window with two tabs — Markdown (with title, date and tags) and plain text: you see what you copy before you copy it. It is now in the archive and the mobile log too.
- **[RU]** Под полем чата ИИ — индикатор квоты: за два вызова до конца он желтеет, на нуле краснеет и показывает время сброса в вашем часовом поясе; кнопка отправки блокируется до нажатия. Чат и рассуждения считаются отдельно — исчерпав чат, вы по-прежнему можете задать вопрос в режиме рассуждений.
- **[EN]** Under the AI chat box, a quota meter: two calls from the end it turns amber, at zero red with the reset time in your local zone; the send button disables before you press it. Chat and reasoning count separately — spending chat still leaves reasoning available.
- **[RU]** Сброс пароля: после отправки экран называет адрес, напоминает про «Спам» и даёт «Отправить ещё раз» с таймером на 60 секунд и «Указать другой адрес» — без перезагрузки. В настройках безопасности появилось «Выйти на остальных устройствах».
- **[EN]** Password reset: after sending, the screen names the address, reminds about spam, and offers «Send again» with a 60-second timer and «Use another address» — without a reload. Security settings gained «Sign out of other devices».
- **[RU]** Новая страница «Помощь» с пошаговым разбором «Заметки не видны?»: по одному вопросу за раз — тот же аккаунт? то же устройство? — и в конце одно действие. Доступна из «Настройки → О приложении».
- **[EN]** A new Help page with a step-by-step «Notes not visible?» guide: one question at a time — same account? same device? — ending in the one thing to do. Reachable from Settings → About.
- **[RU]** Активный пункт меню теперь сплошная плашка вместо подкрашенной полосы; заголовки разделов настроек — с мелким моно-номером над названием. 46 мест, где цвета состояний были заданы напрямую, переведены на цвета темы — светлая тема стала читаемее, тёмная — ровнее.
- **[EN]** The active menu item is now a solid pill instead of a tinted strip; settings section headers get a small mono number above the title. 46 places that hard-coded state colours now use the theme — the light theme reads better, the dark theme is more consistent.
- **[RU]** Индикатор квоты ИИ показывает время до сброса относительно — «через N ч» вместо времени на циферблате, которое сбивало с толку в часовых поясах вдали от UTC.
- **[EN]** The AI quota meter shows the time to reset relatively — «in N h» instead of a clock time that was confusing in zones far from UTC.
- **[RU]** Досметка цветов завершена: оставшиеся сырые цвета (жёлтый, зелёный, красный) переведены на цвета темы — состояния выглядят одинаково во всём приложении.
- **[EN]** The colour sweep is complete: the remaining raw colours (amber, emerald, rose) now use the theme tokens — state colours look the same across the whole app.

## 0.8.47 — 2026-09-12

- **[RU]** После включения сейфа раздел настроек больше не показывает «Шифрование не настроено», хотя заметки уже шифруются: профиль обновляется сразу после настройки. Заметки при этом всё время уходили в облако зашифрованными — это была ошибка только в надписи.
- **[EN]** After the vault is turned on, the settings section no longer shows “Encryption not configured” while notes are already being encrypted: the profile is refreshed right after setup. The notes were going to the cloud encrypted the whole time — the bug was only in the label.

## 0.8.46 — 2026-09-12

- **[RU]** Приглашение в бету: владелец отправляет письмо одной командой на сервере, человек задаёт пароль по ссылке — с телефона тоже — и входит. Регистрация в интерфейсе остаётся закрытой.
- **[EN]** Beta invitations: the owner sends a mail with one command on the server, the person sets a password from the link — on a phone too — and signs in. Sign-up in the UI stays closed.

## 0.8.45 — 2026-09-12

- **[RU]** Ссылка для смены пароля теперь работает в любом браузере — в том числе во встроенном браузере почтового приложения на телефоне. Раньше она открывалась только там, где сброс запросили; на телефоне человек видел «Откройте эту страницу по ссылке из письма», а второе нажатие получало «ссылка устарела».
- **[EN]** The password reset link now works in any browser — including the mail app’s built-in browser on a phone. Before, it opened only where the reset was requested; on a phone the person saw “open this page from the mail link”, and a second tap got “link expired”.
- **[RU]** Заметки, написанные гостем, больше не пропадают из виду при входе через страницу /login (туда ведёт «Я» на телефоне). Предложение перенести их теперь живёт над маршрутизатором и не исчезает вместе со страницей входа. «Оставить локальными» запоминается — спрашиваем один раз.
- **[EN]** Notes written as a guest no longer vanish from view when signing in through the /login page (the phone’s “Me” page leads there). The offer to move them now lives above the router and does not disappear with the login page. “Keep local” is remembered — asked once.
- **[RU]** Включение сейфа теперь шифрует заметки, написанные до него, в обоих местах, где сейф можно включить, и показывает, сколько зашифровано. Раньше они оставались открытым текстом в облаке до нажатия отдельной кнопки в другом разделе, на которую ничто не указывало.
- **[EN]** Turning the vault on now encrypts the notes written before it, in both places the vault can be set up, and says how many. Before, they stayed plaintext in the cloud until a separate button in another section — which nothing pointed at — was pressed.
- **[RU]** Режим рассуждений получил свой дневной счётчик (5) и своё число на экране: «чат N/30 · рассуждения M/5». Раньше пять любых сообщений исчерпывали рассуждения, а виджет показывал 25 оставшихся и «дневной лимит достигнут».
- **[EN]** Reasoning mode has its own daily counter (5) and its own number on screen: “chat N/30 · reasoning M/5”. Before, five messages of any kind used up reasoning while the widget showed 25 left and “daily limit reached”.
- **[RU]** Предупреждение при создании сейфа больше не противоречит следующему экрану: «вернуть доступ можно только кодом восстановления». Счётчик ИИ на устройстве привязан к аккаунту, а не к браузеру. Согласие на ИИ при отзыве говорит, что уже вычисленное остаётся до «Удалить все данные ИИ». Окно политики прокручивается на маленьких экранах; страница входа больше не уезжает вбок на 390 px.
- **[EN]** The vault set-up warning no longer contradicts the next screen: “access can be restored only with the recovery code”. The on-device AI counter is keyed to the account, not the browser. Withdrawing AI consent says that what was already computed stays until “Delete all AI data”. The privacy dialog scrolls on small screens; the login page no longer overflows sideways at 390 px.

## 0.8.44 — 2026-09-12

- **[RU]** Ответ модели, который пришёл, но не разобрался, больше не возвращает вызов в дневной лимит: слот возвращается только если модель произвела меньше 200 символов, независимо от причины сбоя. Раньше в коде жили два правила, и старое побеждало — тест, написанный для нового, закреплял старое.
- **[EN]** A model answer that arrived but could not be parsed no longer refunds the call to the daily limit: the slot is refunded only when the model produced under 200 characters, whatever the failure reason. Two rules lived in the code and the older one won — the test written for the new one pinned the old.
- **[RU]** Заметка, которую в этот момент скачивает другая вкладка, больше не считается «не удалось»: «Синхронизировать всё» не пишет ошибку, а значок хранилища говорит «Заметка уже загружается».
- **[EN]** A note another tab is downloading right now is no longer counted as “failed”: “Sync everything” shows no error for it, and the storage icon says “This note is already being downloaded”.
- **[RU]** Проверка «заметка слишком велика для облака» теперь считает то же, что и база: символы одной версии — шифротекст под сейфом, сам текст без него. Раньше клиент мерил байты с довеском прошлой версии по формуле из времён Firestore и мог отказать заметке, которую сервер принял бы, или пропустить ту, которую сервер отвергнет. Отказ базы по ограничению теперь уходит в карантин с первой попытки, а не после десяти.
- **[EN]** The “note too large for the cloud” check now measures what the database measures: characters of one version — ciphertext under the vault, the text itself without it. Before, the client counted bytes plus the previous version by a Firestore-era formula and could refuse a note the server would accept, or pass one the server would reject. A database constraint refusal now goes to quarantine on the first attempt instead of after ten.
- **[RU]** Двенадцать исправлений последних двух версий получили тесты, которые краснеют, если исправление убрать: «Удалить все данные ИИ» на сервере раньше локального, запрет пустой облачной копии, страховка автосохранения при непрерывном наборе, различение «сервис не может проверить лимит» и сбоя поставщика, детектор непереведённых диалогов и другие. Ни один из них раньше не имел свидетеля.
- **[EN]** Twelve fixes from the last two releases now have tests that go red when the fix is removed: “Delete all AI data” on the server before the device, the refusal of an empty cloud copy, the autosave safety net under continuous typing, the difference between “could not check the limit” and a provider outage, the untranslated-dialog detector, and more. None of them had a witness before.

## 0.8.43 — 2026-09-11

- **[RU]** Черновик при включённом сейфе не доходил до облака, если заголовок длиннее ~60 кириллических символов или текст больше ~37 тысяч: шифротекст не проходил ограничение базы, второе устройство видело старый черновик. Ограничение расширено, а постоянный отказ теперь виден в значке редактора, а не только в журнале.
- **[EN]** A draft with the vault on could not reach the cloud once its title passed ~60 Cyrillic characters or its text ~37k: the ciphertext exceeded a database limit and the second device saw the old draft. The limit is raised, and a permanent refusal now shows in the editor badge instead of only the log.
- **[RU]** «Удалить все данные ИИ» теперь удаляет на сервере то, что обещало: эмбеддинги, конспекты и зеркала локальных хранилищ. Раньше очищалось только устройство, а сообщение говорило, что удалено всё.
- **[EN]** “Delete all AI data” now deletes on the server what it promised: embeddings, summaries and the mirrored local stores. Before, only the device was cleared while the message said everything was gone.
- **[RU]** Заметка без текста на устройстве больше не выгружается файлом с заголовком и пустым телом — экспорт отказывает и объясняет почему. «В этот день» сохраняет совпадение и пишет «Заметка заперта» или «Содержимое недоступно» вместо пустого отрывка.
- **[EN]** A note with no text on the device can no longer be exported as a file with a header and an empty body — export refuses and says why. “On this day” keeps the match and says “Note is locked” or “Content unavailable” in place of an empty excerpt.
- **[RU]** Текст, попавший в редактор без нажатий клавиш — вставка, диктовка, мобильная клавиатура, — раньше не запускал автосохранение. Теперь автосохранение идёт от наличия текста, а 30-секундная страховка больше не сбрасывается на каждом символе.
- **[EN]** Text that arrived without a keystroke — paste, dictation, a mobile keyboard — used to leave autosave idle. Autosave now keys off the presence of text, and the 30-second safety net no longer restarts on every character.
- **[RU]** Второе устройство с запертым сейфом: облачный черновик перечитывается при разблокировке, а не затирается тем, что набрано следом. «Продолжить» другую заметку спрашивает, прежде чем заменить несохранённый текст.
- **[EN]** Second device with the vault locked: the cloud draft is re-read on unlock instead of being overwritten by whatever is typed next. “Continue” on another note asks before replacing unsaved text.
- **[RU]** Скачивание из облака выполняется по одному на аккаунт, откуда бы оно ни запустилось. Два запуска подряд создавали по лишней локальной копии на каждую облачную заметку, а затем отправляли их в облако как новые пустые документы.
- **[EN]** Cloud download runs one at a time per account, whichever trigger fires. Two runs within a second created an extra local copy per cloud note and then uploaded them as new, empty cloud documents.
- **[RU]** «Синхронизировать всё» при запертом сейфе говорит, что сейф заперт, а не «синхронизировано: 0». Четыре постоянные ошибки синхронизации уходят в карантин с первой попытки, а не после десяти.
- **[EN]** “Sync everything” with a locked vault says the vault is locked instead of “synced: 0”. Four permanent sync errors go to quarantine on the first attempt instead of after ten.
- **[RU]** Заморозки серии стали отдельными для гостя и аккаунта, переезжают между устройствами и хранятся в том же зашифрованном конверте, что и остальные записи.
- **[EN]** Streak freezes are now separate for guest and account, travel between devices, and are stored in the same encrypted envelope as every other record.
- **[RU]** Сбой проверки лимита ИИ (база недоступна или аккаунт удалён с другого устройства) показывается как «не удалось проверить лимит», а не как «дневной лимит достигнут». Ответ модели с испорченным JSON учитывается, а не возвращается.
- **[EN]** A failed AI limit check (database down, or the account deleted from another device) is reported as “could not check the limit”, not as “daily limit reached”. A model answer with malformed JSON is charged, not refunded.
- **[RU]** Микрофон был заблокирован на сайте нашим же заголовком с мая — диктовка не могла запросить доступ. Заголовок исправлен, проверка после выкатки следит, чтобы это не повторилось. Диктовка один раз предупреждает, что звук уходит в речевой сервис производителя браузера; при включённом сейфе — спрашивает каждый раз.
- **[EN]** The microphone had been blocked on the site by our own header since May — dictation could not ask for access. The header is fixed and the post-deploy check watches that it stays so. Dictation states once that audio goes to the browser vendor’s speech service; with the vault on it asks every time.
- **[RU]** Окно завершения считает слова сессии и показывает «всего: N», когда продолжается старая заметка. Импорт заметки с нечитаемой датой берёт дату соседей или манифеста и сообщает, сколько таких было.
- **[EN]** The finish window counts the session’s words and shows “total: N” when continuing an older note. Importing a note with an unreadable date falls back to sibling or manifest dates and reports how many.

## 0.8.42 — 2026-09-08

- **[RU]** Второе устройство наконец забирает заметки из облака. Функция скачивания существовала, но её никто не вызывал: архив показывал правильные заголовки, даты и число слов, а текста на устройстве не было ни байта. Теперь скачивание запускается при входе, при возвращении сети и при разблокировке сейфа.
- **[EN]** A second device finally fetches the notes from the cloud. The download existed but nothing called it: the archive showed the right titles, dates and word counts while not one byte of the text was on the device. It now runs on sign-in, when the network comes back, and when the vault is unlocked.
- **[RU]** «Продолжить писать» больше не открывает облачную заметку пустой: текст подтягивается, а связь с облачной копией не теряется.
- **[EN]** «Continue writing» no longer opens a cloud note blank: the text is fetched and the link to the cloud copy is kept.
- **[RU]** У значка хранилища появился способ забрать заметку на устройство — раньше он умел только удалить ту копию, что уже здесь.
- **[EN]** The storage icon can now bring a note down to the device — before, it could only delete the copy that was already here.
- **[RU]** Импорт заметки, выгруженной старой версией, больше не проставляет ей сегодняшнюю дату молча.
- **[EN]** Importing a note exported by an older version no longer stamps it with today's date in silence.
- **[RU]** Перепривязка, пропущенная из-за занятого замка, больше не превращается в дубль заметки в облаке.
- **[EN]** A relink skipped because the lock was held no longer turns into a duplicate note in the cloud.
- **[RU]** Ошибка расшифровки последней версии больше не гоняется десять раз впустую: она отнесена к правилам и оживает при разблокировке сейфа.
- **[EN]** A failure to decrypt the latest version is no longer retried ten times for nothing: it is covered by the rules and revives when the vault is unlocked.
- **[RU]** Сбой разбора ответа модели больше не возвращает вызов и не отдаёт пустой список как успех, а ветка рассуждений перестала записывать расход дважды при обрыве.
- **[EN]** A malformed model answer no longer refunds the call and returns an empty list as success, and the reasoning branch stopped recording its usage twice when the stream fails.
- **[RU]** На мобильных экранах шестнадцать элементов управления доведены до минимального размера нажатия.
- **[EN]** Sixteen controls on the mobile screens were brought up to the minimum touch size.
- **[RU]** В профиле больше не встречаются «0 дней» и «1 дней подряд» на одном экране.
- **[EN]** The profile no longer shows «0 days» and «1 days in a row» on the same screen.
- **[RU]** Диагностика объясняет гостю, что нужно и зачем, вместо одной строки «требуется регистрация».
- **[EN]** The diagnostics screen explains to a guest what is needed and why, instead of a bare «sign-up required».

## 0.8.41 — 2026-09-07

- **[RU]** Экспортированная заметка снова импортируется обратно без потерь: экспорт и импорт наконец говорят на одном формате, а файлы прежних версий по-прежнему читаются.
- **[EN]** An exported note imports back without losses again: the exporter and the importer finally speak one format, and files from earlier versions still read.
- **[RU]** Перенос архива больше не теряет метки: они переносятся отдельно и с проверкой, а ссылки на несуществующие метки снимаются и попадают в отчёт об импорте.
- **[EN]** Migrating an archive no longer loses labels: they are carried over separately and validated, and references to labels that no longer exist are dropped and reported.
- **[RU]** Карточка «в этот день» показывает ту дату, по которой нашла совпадение, а не дату создания заметки.
- **[EN]** The "on this day" card shows the date it matched on, not the date the note was created.
- **[RU]** Общий дневной лимит ИИ больше не расходуется впустую: оборванный ответ списывал полный резерв токенов, хотя модель успевала выдать малую часть.
- **[EN]** The shared daily AI ceiling is no longer spent on nothing: an aborted answer used to consume the full token reservation, though the model had produced only a fraction of it.
- **[RU]** Заметка, чью облачную версию не удалось сравнить, больше не уходит в карантин с первой попытки и оживает при разблокировке сейфа.
- **[EN]** A note whose cloud version could not be compared is no longer quarantined on the first attempt, and comes back when the vault is unlocked.
- **[RU]** Сейф, открытый в другой вкладке, теперь и выпускает задачи из карантина, и запускает синхронизацию — раньше они ждали следующего повода.
- **[EN]** A vault unlocked in another tab now both releases the quarantined tasks and starts the sync — they used to wait for the next trigger.
- **[RU]** Архив на большом числе заметок открывается быстрее: метаданные подходов читаются одним проходом вместо обращения к базе на каждую заметку.
- **[EN]** A large archive opens faster: sitting metadata is read in one pass instead of one database round trip per note.
- **[RU]** Удаление аккаунта больше не рапортует об успехе, когда локальная база осталась на устройстве из-за открытой соседней вкладки.
- **[EN]** Deleting an account no longer reports success when the local database survived because another tab was holding it open.
- **[RU]** Подтверждения необратимых действий переведены: восемь диалогов были захардкожены по-русски, один по-английски.
- **[EN]** The confirmations for irreversible actions are translated: eight dialogs were hard-coded in Russian and one in English.
- **[RU]** Текст, импортированный из чужого файла, больше не может подделать границы данных в промпте — маркеры распознаются и с пробелами в теге, и с похожими буквами кириллицы и греческого.
- **[EN]** Text imported from someone else's file can no longer forge the data boundaries in the prompt — the markers are recognised with spaces inside the tag and with Cyrillic or Greek look-alike letters.

## 0.8.40 — 2026-09-06

- **[RU]** Черновик больше не может попасть в общую гостевую базу. Выход из аккаунта в одной вкладке обнулял состояние во всех, и автосохранение в соседней записывало текст в базу, доступную следующему гостю на устройстве. Теперь база берётся из владельца записи, а запись без владельца просто не делается.
- **[EN]** A draft can no longer end up in the shared guest database. Signing out in one tab reset the state in all of them, and autosave in a neighbouring tab wrote the text into a database the next guest on the device could open. The database is now chosen by the record's owner, and a record without one is not written at all.
- **[RU]** Администратор больше не может прочитать психологический портрет другого человека: политика доступа сужена до собственной строки, а служебная вкладка работает через отдельное представление без портрета и ключей.
- **[EN]** An administrator can no longer read another person's psychological portrait: the access policy is narrowed to their own row, and the admin screen works through a separate view that carries neither the portrait nor any key material.
- **[RU]** Удаление аккаунта убирает саму локальную базу, а не только её содержимое — на устройстве не остаётся даже её имени как следа того, что аккаунт существовал.
- **[EN]** Deleting an account removes the local database itself, not only its contents — not even its name is left on the device as a trace that the account existed.
- **[RU]** История заметки больше не схлопывается в один день. Продолжение старой заметки гасило предыдущие дни в тепловой карте и обрывало серию; теперь считаются все подходы.
- **[EN]** A note's history no longer collapses into a single day. Continuing an old note used to erase the earlier days from the heat map and break the streak; every sitting is counted now.
- **[RU]** Сейф, открытый в одной вкладке, виден остальным: соседняя вкладка больше не откладывает задачи синхронизации в карантин, пока сейф уже открыт. Сам ключ между вкладками не передаётся — только факт разблокировки.
- **[EN]** A vault unlocked in one tab is visible to the others: a neighbouring tab no longer quarantines sync tasks while the vault is already open. The key itself never travels between tabs — only the fact of unlocking.
- **[RU]** Разблокировка сейфа перестала быть медленной: при чтении настроек терялось число раундов, и каждая попытка пароля перебирала сначала 600 000, потом 300 000 — на телефоне это были секунды замершего экрана после опечатки.
- **[EN]** Unlocking the vault is no longer slow: the number of rounds was dropped when the settings were read, so every password attempt tried 600,000 and then 300,000 of them — seconds of a frozen screen on a phone after a typo.
- **[RU]** Две операции синхронизации больше не берутся за один документ одновременно: у замка появился владелец, и снять его может только он.
- **[EN]** Two sync operations no longer take the same document at once: the lock has an owner, and only its owner can release it.
- **[RU]** Проверка расхождений с облаком больше не останавливается на первой тысяче строк, а списки архива и обозреватель базы перестали вычитывать все версии целиком ради счётчика — на большом архиве это укладывало вкладку на телефоне.
- **[EN]** The cloud discrepancy check no longer stops at the first thousand rows, and the archive lists and the database explorer no longer read every version in full just to count them — on a large archive that used to kill the tab on a phone.
- **[RU]** Карточка «в этот день» перестала промахиваться мимо месяца 29-го, 30-го и 31-го числа.
- **[EN]** The «on this day» card no longer misses the month on the 29th, 30th and 31st.
- **[RU]** Вкладка, пережившая выкатку, больше не показывает пустой архив молча: появляется сообщение, что приложение обновилось в другой вкладке, и предложение обновить страницу — данные на месте.
- **[EN]** A tab that outlived a deploy no longer shows an empty archive in silence: it now says the application was updated in another tab and offers to reload — the data is where it was.
- **[RU]** Обрыв связи после того, как модель начала отвечать, больше не возвращает дневную квоту; возврат остаётся, когда ответ так и не начался. Сбой разбора ответа показывается как ошибка провайдера, а не как «текст слишком длинный».
- **[EN]** Losing the connection after the model has begun answering no longer refunds the daily quota; the refund stays for the case where the answer never started. A failure to parse the answer is shown as a provider error rather than «the text is too long».
- **[RU]** «Схлопнуть версии» удаляет старые снимки и в облаке, поэтому следующая синхронизация не возвращает их обратно, а подтверждение теперь честно говорит, сколько версий будет удалено и что это необратимо на всех устройствах.
- **[EN]** «Collapse versions» now deletes the old snapshots in the cloud as well, so the next sync does not bring them back, and the confirmation says honestly how many versions will go and that it cannot be undone, on any device.

## 0.8.39 — 2026-09-04

- **[RU]** Заметка, чей текст начинается со слова вроде «Eyes», больше не выпадает из синхронизации навсегда. Признак «это шифротекст» угадывался по первым буквам и совпадал с обычной прозой; теперь берётся честная пометка о шифровании.
- **[EN]** A note whose text begins with a word like «Eyes» no longer drops out of syncing for ever. Whether a text was ciphertext used to be guessed from its first letters, which ordinary prose matches; the honest encryption flag is used instead.
- **[RU]** Отсутствующая облачная версия больше не считается совпадающей с пустой заметкой, а нечитаемая сторона — отличающейся. И то и другое теперь называется неизвестностью, и сверка откладывается.
- **[EN]** An absent cloud version is no longer treated as equal to an empty note, nor an unreadable side as a different one. Both are now called unknown, and the comparison waits.
- **[RU]** Режим рассуждений больше не теряет память диалога: контекст доезжал до модели только в обычном режиме.
- **[EN]** Reasoning mode no longer loses the dialogue memory: the context used to reach the model in the ordinary mode only.
- **[RU]** Восстановление из облака больше не называет успешное восстановление неудачей и правильно считает восстановленные записи ИИ.
- **[EN]** Restoring from the cloud no longer calls a successful restore a failure, and counts the restored AI records correctly.
- **[RU]** Общее время письма на мобильном экране «Обо мне» показывалось в шестьдесят раз больше настоящего — час письма выглядел как «60ч».
- **[EN]** Total writing time on the mobile «About me» screen was shown sixty times too large — an hour of writing looked like «60h».
- **[RU]** Сессия без ограничения по времени больше не объявляет, что цель по времени достигнута.
- **[EN]** A session with no time limit no longer announces that its time goal was reached.
- **[RU]** На мобильном экране профиля вернулся график настроения, а вместо трёх служебных ключей показывается текст. Подтверждение удаления аккаунта переведено, а не зашито по-русски.
- **[EN]** The mood trend is back on the mobile profile screen, and three raw translation keys are shown as text again. The account-deletion confirmation is translated rather than hard-coded in Russian.
- **[RU]** Значок «ошибка» больше не загорается из-за чужого кода. Когда сайт открыт внутри стороннего фрейма или расширения браузера, внешний скрипт получает отказ в доступе к нашему окну — и эта чужая ошибка записывалась как наша. Свои ошибки, включая отказы доступа по нашей вине, по-прежнему видны.
- **[EN]** The «error» badge no longer lights up because of somebody else's code. When the site is open inside a third-party frame or a browser extension, the outside script is refused access to our window — and that foreign error was recorded as ours. Real errors, including access refusals that are our fault, are still reported.

## 0.8.38 — 2026-09-04

- **[RU]** Удаление заметки теперь честно говорит, дошло ли оно до облака. Если сети нет или облако не ответило, вместо «удалено» появится «Удалено на этом устройстве — из облака удалится позже», а число таких отложенных удалений видно в настройках синхронизации.
- **[EN]** Deleting a note now says honestly whether the deletion reached the cloud. With no network, or a cloud that did not answer, «deleted» is replaced by «Deleted on this device — will be removed from the cloud later», and the number of such pending deletions is visible in the sync settings.
- **[RU]** Нечитаемая облачная версия больше не порождает «конфликтную копию» на пустом месте. Если одну из сторон не удалось расшифровать, приложение считает её неизвестной, а не отличающейся, и откладывает сверку до следующего раза.
- **[EN]** An unreadable cloud version no longer produces a «conflict copy» out of nothing. When one side cannot be decrypted, the app treats it as unknown rather than different, and leaves the comparison for the next attempt.
- **[RU]** Заметка, у которой счётчик версий отставал от их настоящего числа, больше не выглядит для другого устройства уже загруженной — иначе последняя версия туда никогда бы не приехала.
- **[EN]** A note whose version counter lagged behind the number of versions it actually holds no longer looks up to date to another device — otherwise the latest version would never have reached it.
- **[RU]** Настроение сессии теперь шифруется и в версиях, а не только в заметке.
- **[EN]** The mood of a session is now encrypted on versions too, not only on the note.

## 0.8.37 — 2026-09-04

- **[RU]** Настроение сессии больше не уходит в облако открытым: при включённом сейфе оно шифруется наравне со всем остальным, а записи, сделанные прежними версиями приложения, продолжают читаться.
- **[EN]** The mood of a session no longer reaches the cloud in the clear: with the vault on it is encrypted like everything else, and entries written by earlier versions keep opening.
- **[RU]** Восстановление заметки из облака больше не теряет отмеченное настроение.
- **[EN]** Restoring a note from the cloud no longer loses the mood that was marked.
- **[RU]** Метки черновика шифруются перед отправкой — раньше они уезжали открытым текстом.
- **[EN]** Draft tags are encrypted before upload — they used to travel in the clear.
- **[RU]** Включение шифрования охватывает и то, что ИИ вывел о вас: разборы, векторы и записи памяти, а не только заметки и версии.
- **[EN]** Turning encryption on now covers what the AI concluded about you too — analyses, vectors and memory records, not only notes and versions.
- **[RU]** Заметка ничего не отправляет ИИ сама по себе: путь, на котором сохранение версии могло запустить индексацию, убран, а окно согласия теперь говорит не только что отправляется, но и когда.
- **[EN]** A note sends nothing to the AI by itself: the path where saving a version could start indexing is gone, and the consent dialogue now says not only what is sent but when.
- **[RU]** Удаление заметки убирает и её задачи синхронизации — раньше они оставались гоняться за строкой, которой уже нет.
- **[EN]** Deleting a note also clears its sync tasks — they used to keep chasing a row that no longer exists.
- **[RU]** Заметка, чей номер занят удалённой облачной строкой, больше не запирается навсегда с непонятной ошибкой: приложение говорит, что облачная копия была удалена, заметка остаётся на устройстве, а повторное «отправить в облако» создаёт новую копию.
- **[EN]** A note whose id is held by a deleted cloud row is no longer locked away with a cryptic error: the app says the cloud copy was deleted, the note stays on the device, and pressing «upload» again makes a new copy.
- **[RU]** Задачи чужого аккаунта в очереди больше не блокируют отправку, а выход из аккаунта их не стирает.
- **[EN]** Another account's queued tasks no longer block uploads, and signing out no longer erases them.
- **[RU]** Заблокированный сейф больше не заклинивает очередь: такие задачи уходят в карантин сразу и оживают после разблокировки.
- **[EN]** A locked vault no longer jams the queue: those tasks are quarantined at once and revive once it is unlocked.
- **[RU]** Догон версий с другого устройства больше не падает, когда облако присылает время числом.
- **[EN]** Catching up on versions from another device no longer crashes when the cloud sends a timestamp as a number.

## 0.8.36 — 2026-09-03

- **[RU]** Правка, сделанная на одном устройстве, больше не затирает молча правку, сделанную на другом. Приложение считало совпадение исходной версии признаком отсутствия конфликта — хотя совпадение исходной и есть конфликт: обе правки выросли из одного места. Текст второго устройства просто становился текущим, а работа первого уходила в историю, которую ни один экран не показывает. Теперь расхождение сохраняется отдельной заметкой «Конфликтная копия», оба текста остаются целыми, а у человека с одним устройством копия не появляется никогда.
- **[EN]** An edit made on one device no longer silently overwrites an edit made on another. A matching base version was treated as the absence of a conflict — although a matching base IS a conflict: both edits grew from the same place. The second device's text simply became current while the first device's work went into a history no screen shows. Divergence is now kept as a separate "conflict copy", both texts survive, and someone with a single device never sees one.
- **[RU]** Состояние синхронизации сравнивает содержимое, а не наличие ссылки: заметка, связанная с пустой облачной строкой, больше не числится отправленной. Заметки, про которые пока ничего не известно, названы неизвестными, а не отправленными и не потерянными; истина выясняется одним запросом и запоминается.
- **[EN]** The sync state compares content rather than the presence of a link: a note linked to an empty cloud row is no longer counted as uploaded. Notes whose state is not yet known are called unknown rather than uploaded or lost; the truth is resolved in one query and remembered.
- **[RU]** «Заметка сохранена» говорится только когда она действительно в облаке. Иначе — «Сохранено на этом устройстве, в облако отправится позже».
- **[EN]** "Note saved" is said only when it really is in the cloud. Otherwise: "Saved on this device, it will reach the cloud later".
- **[RU]** «Отправить все заметки в облако» отправляет и те, что связаны, но отстали, а очередь разбирается после всех, кто в неё добавляет. Кнопки синхронизации сообщают, что произошло на самом деле, а не «готово» при выключенной автоотправке.
- **[EN]** "Upload all notes" also uploads notes that are linked but behind, and the queue is drained after everything that fills it. The sync buttons report what actually happened instead of "done" while auto-upload is off.
- **[RU]** Брошенная задача синхронизации больше не держит индикатор в «приостановлено» навсегда: она считается отдельно, а задачи, упавшие на запертом сейфе, оживают после его разблокировки.
- **[EN]** An abandoned sync task no longer holds the indicator at "paused" forever: it is counted separately, and tasks that failed on a locked vault revive once it is unlocked.
- **[RU]** Заметка, чью облачную копию удалили с другого устройства, больше не запирается навсегда: её правки возвращаются в облако под собственным постоянным номером, поэтому разбор и вектор остаются привязанными.
- **[EN]** A note whose cloud copy was deleted from another device is no longer locked away forever: its edits return to the cloud under their own permanent id, so the analysis and vector stay attached.
- **[RU]** Версии выгружаются строго по порядку, пропуск в середине истории обнаруживается, а сбой чтения облака показывается как «облако недоступно», а не как «всё синхронизировано».
- **[EN]** Versions upload strictly in order, a gap in the middle of the history is detected, and a failed cloud read is shown as "cloud unavailable" rather than "all synced".

## 0.8.35 — 2026-09-03

- **[RU]** «Все данные синхронизированы» больше не говорится, когда это неправда. При выключенной автоотправке — а она выключена по умолчанию — состояние назначалось «синхронизировано» сразу, не глядя на данные, а счётчик незалитых принудительно обнулялся. Приложение сообщало, что всё в облаке, человеку, у которого четырнадцать заметок лежали ровно в одном браузере. Теперь незалитые считаются всегда, «синхронизировано» говорится только когда в облаке действительно всё, а выключенная автоотправка при полном облаке — отдельное состояние со своими словами.
- **[EN]** "All data synced" is no longer said when it is untrue. With auto-upload off — and it is off by default — the state was set to "synced" immediately, without looking at the data, and the count of un-uploaded notes was forced to zero. The app told someone everything was in the cloud while fourteen notes lived in exactly one browser. Un-uploaded notes are now always counted, "synced" is said only when the cloud really has everything, and auto-upload being off with a complete cloud is its own state with its own words.
- **[RU]** Значок синхронизации показывается и при выключенной автоотправке: незалитые заметки — повод сказать, а не молчать.
- **[EN]** The sync indicator appears with auto-upload off as well: notes missing from the cloud are worth saying out loud, not staying quiet about.
- **[RU]** Перепривязка по постоянному номеру теперь действительно запускается. Проход проверял пригодность заметок до чтения облака, и заметки, помеченные «только на устройстве», в эту проверку не попадали — то есть исправление стояло за воротами, которые его не пускали, а кнопка честно сообщала «синхронизировано 0».
- **[EN]** Relinking by permanent id now actually runs. The pass tested notes for eligibility before reading the cloud, and notes marked device-only failed that test — so the fix sat behind a gate that excluded it, and the button truthfully reported "0 synced".
- **[RU]** Отказ выгрузить заметку, помеченную «только на устройстве», больше не молчит: кнопка, которая ничего не делает и ничего не говорит, читается как поломка.
- **[EN]** Refusing to upload a device-only note is no longer silent: a button that does nothing and says nothing reads as broken.

## 0.8.34 — 2026-09-03

- **[RU]** Заметка, потерявшая связь со своей облачной копией, теперь находит её по постоянному номеру и уезжает в облако. Раньше вернуть такую было нельзя ничем: выгрузка как новой падала — строка с этим номером уже существовала, — а сверка по времени не помогала, потому что у осиротевшей строки записано время её создания, а не дата заметки. Четырнадцать заметок так и лежали только на устройстве.
- **[EN]** A note that lost the link to its cloud copy now finds it by the permanent id and reaches the cloud. Such a note could not be recovered before: uploading it as new failed — a row with that id already existed — and matching by time did not help, because an orphaned row records when it was created, not the note's date. Fourteen notes were left on the device alone.
- **[RU]** Текст диалога больше не уходит на сервер до проверки согласия: проверка была только на сервере, то есть содержимое уже улетало по сети, и лишь потом получало отказ.
- **[EN]** Conversation text no longer leaves for the server before the consent check: the check lived on the server only, so the content was already on the wire before being refused.
- **[RU]** Удаление облачной копии заметки уносит и её разбор с вектором — раньше они оставались в базе без заметки.
- **[EN]** Removing a note's cloud copy now removes its analysis and vector too — they used to stay in the database with no note.
- **[RU]** Удаление аккаунта больше не останавливается на полпути: серверная половина отрабатывала, а стирание на устройстве прерывалось проверкой несохранённого.
- **[EN]** Deleting an account no longer stops halfway: the server half worked while the device wipe was aborted by the unsynced-data check.
- **[RU]** Неудачная очистка устройства при выходе больше не выглядит удачной: ошибка базы проглатывалась, и выход сообщал об успехе.
- **[EN]** A failed device wipe on sign-out no longer looks successful: the database error was swallowed and sign-out reported success.
- **[RU]** Удаление записи ИИ из облака не теряется при обрыве связи — намерение возвращается в очередь.
- **[EN]** Deleting an AI record from the cloud is no longer lost on a network failure — the intent goes back into the queue.

## 0.8.33 — 2026-09-03

- **[RU]** Данные ИИ больше не общие на устройстве: у каждого аккаунта своя локальная база. Раньше портрет лежал в единственной строке на браузер, а память чата, убеждения и разборы не знали владельца вовсе — второй вошедший на том же компьютере видел чужое, а выгрузка записывала это ему в облако. Существующий архив переезжает при первом открытии, и оригиналы удаляются только после проверки, что копия на месте.
- **[EN]** AI data is no longer shared on a device: each account gets its own local database. The portrait used to live in a single row per browser, and chat memory, beliefs and analyses carried no owner at all — a second person signing in on the same computer saw someone else's, and the upload wrote it into their cloud. An existing archive moves across on first open, and the originals are deleted only after the copy is verified.
- **[RU]** Поиск и разбор «дверей контакта» больше не читают чужие заметки: и указатель поиска, и его кэш привязаны к аккаунту.
- **[EN]** Search and the contact-doors analysis no longer read another owner's notes: both the index and its cache are keyed to the account.
- **[RU]** Удалённая в облаке заметка больше не воскресает: оба места, реагирующие на удаление, помечают её локальной, а не только одно из двух.
- **[EN]** A note deleted in the cloud no longer comes back: both places that react to the deletion mark it local-only, not just one of the two.
- **[RU]** Статистика версий не портится при шифровании: числа слов и знаков передаются посчитанными, а не пересчитываются поверх шифротекста, где всё выглядит одним словом.
- **[EN]** Version statistics survive encryption: word and character counts are passed through instead of recomputed over ciphertext, where everything looks like a single word.
- **[RU]** Пропали лишние копии заметок «(Конфликт …)»: облачные версии расшифровываются перед сравнением, а не сравниваются с открытым текстом как есть.
- **[EN]** Spurious "(Conflict …)" duplicates are gone: cloud versions are decrypted before comparison instead of being compared to plaintext as-is.
- **[RU]** Восстановление на чистом устройстве предлагается всегда, когда в облаке заметок больше, чем на устройстве, и возвращает поисковые векторы, а не только тексты. Большие архивы читаются страницами — раньше выборка молча обрывалась на тысяче строк.
- **[EN]** Restore on a clean device is offered whenever the cloud has more notes than the device, and it brings back search vectors, not only texts. Large archives are read page by page — a query used to stop silently at a thousand rows.
- **[RU]** Прерванная выгрузка версий догоняет пропущенное вместо того, чтобы навсегда оставить дыру в истории.
- **[EN]** An interrupted version upload catches up on what it missed instead of leaving a permanent gap in the history.
- **[RU]** Черновик и статистика письма, накопленные до регистрации, переезжают на аккаунт и уходят в облако.
- **[EN]** The draft and writing statistics accumulated before signing up move to the account and reach the cloud.

## 0.8.32 — 2026-09-03

- **[RU]** Удаление заметки снова уносит её разбор и вектор из облака. Вчерашняя правка этого не делала: постоянный номер заметки искался уже после того, как саму заметку удалили, — находилось «ничего», и в облако уходил запрос на удаление по локальному номеру, которого там нет. Номер теперь снимается до удаления и передаётся уборке.
- **[EN]** Deleting a note removes its analysis and vector from the cloud again. Yesterday's fix did not: the note's permanent number was looked up after the note itself had been deleted — nothing was found, and the cloud received a delete request for a local number it does not use. The number is now taken before deletion and handed to the cleanup.
- **[RU]** Удаление аккаунта стирает данные и с устройства. Серверная половина отрабатывала, а локальная нет: заметки, версии, черновики, разборы и портрет удалённого аккаунта оставались в браузере навсегда.
- **[EN]** Deleting an account now erases data from the device too. The server half worked and the local half did not: notes, versions, drafts, analyses and the portrait of a deleted account stayed in the browser forever.
- **[RU]** «Не показывать заметку ИИ» переживает дорогу в облако и обратно. Колонка в базе была, но выгрузка её не отправляла, а загрузка не восстанавливала — на втором устройстве запрет молча снимался, и заметку начинал читать индексатор. Настроение заметки терялось так же.
- **[EN]** "Do not show this note to the AI" now survives the trip to the cloud and back. The column existed but upload never sent it and download never restored it — on a second device the ban was silently lifted and the indexer began reading the note. The note's mood was lost the same way.

## 0.8.31 — 2026-09-03

- **[RU]** Кнопка «Убрать разборы без заметок» в Настройках → Синхронизация. Убирает разборы и поисковые векторы удалённых заметок — они оставались после удаления по старой логике и лежали мёртвым грузом: отправить их нельзя, а восстановить из них нечего. Перед удалением показывается число и предупреждение, что это безвозвратно; сами заметки и их текст не затрагиваются.
- **[EN]** A "Remove analyses with no note" button in Settings → Sync. It removes analyses and search vectors of deleted notes — they were left behind by the old deletion logic and sat as dead weight: they cannot be uploaded and nothing can be restored from them. The count and an irreversibility warning are shown first; notes and their text are not affected.
- **[RU]** Уборка сверяется с облаком и без этой сверки не делает ничего. «Заметки нет на устройстве» и «заметки нет вообще» — разные вещи: на втором устройстве локально лежит только часть архива, и уборка по одному локальному признаку снесла бы разборы живых заметок.
- **[EN]** The cleanup checks against the cloud and does nothing without that check. "The note is not on this device" and "the note does not exist" are different things: a second device holds only part of the archive locally, and a cleanup by the local signal alone would destroy analyses of living notes.

## 0.8.30 — 2026-09-02

- **[RU]** «Выйти и стереть всё с этого компьютера» теперь действительно стирает всё. Список стираемого перечислял ключи поимённо и дважды разошёлся с приложением: кэш разделов портрета, журнал событий, наблюдения о том, как человек пишет, его поисковые запросы со стенда и незавершённый черновик оставались в браузере. Список перевёрнут — перечисляются настройки устройства (тема, язык, ширина панели), стирается всё остальное. Забытая настройка теперь просто сбросится, а не оставит данные лежать.
- **[EN]** "Sign out and erase everything on this computer" now really does erase everything. The list of what to erase named keys one by one and drifted from the app twice: the portrait section cache, the event log, observations about how the person writes, their bench search queries and an unfinished draft all stayed in the browser. The list is inverted — device settings (theme, language, panel width) are named, everything else is erased. A forgotten setting now merely resets instead of leaving data behind.
- **[RU]** Удаление заметки уносит её разбор и вектор из облака, а не только с устройства. Пока в облаке лежала малая часть разборов, это было незаметно; теперь там весь архив, и восстановление вернуло бы разбор удалённой заметки обратно. То же исправлено для кнопки «удалить разбор»: она стирала облачную строку по локальному номеру заметки, которого в облаке нет.
- **[EN]** Deleting a note removes its analysis and vector from the cloud, not only from the device. While the cloud held a small share of analyses this went unnoticed; now the whole archive is there, and a restore would bring a deleted note's analysis back. The same is fixed for the "delete analysis" button: it erased the cloud row by the note's local number, which the cloud does not use.
- **[RU]** Диалоги, память чата, обязательства, ветки, хроника, история жизни и реестр тем удалённой заметки тоже уходят из облака.
- **[EN]** Dialogues, chat memory, commitments, threads, timeline, life story and the theme ledger of a deleted note now leave the cloud as well.

## 0.8.29 — 2026-09-02

- **[RU]** Психологический портрет больше не остаётся в браузере после выхода из аккаунта и не может достаться другому человеку. Его копия хранилась под общим ключом, не привязанным к аккаунту: выход стирал базу и помеченные ключи, а этот — нет. При пустой базе портрет читается из этой копии, то есть следующий вошедший в том же браузере получал чужой портрет в подсказку на каждом ходу разговора. Копия теперь помечена аккаунтом, входит в список стираемого при выходе, а старая общая копия уносится при первом же чтении.
- **[EN]** The psychological portrait no longer stays in the browser after signing out and can no longer reach another person. Its copy was kept under a shared key with no account attached: signing out cleared the database and the account-tagged keys, but not this one. With an empty database the portrait is read from that copy — so the next person signing in on the same browser received someone else's portrait in the prompt on every turn of a conversation. The copy is now tagged with the account, is on the list of what signing out erases, and the old shared copy is removed on first read.
- **[RU]** Портрет выгружается в облако из базы, а не из этой копии. Копия могла быть пуста в момент, когда до задачи доходила очередь синхронизации, — поэтому в облаке колонка портрета оставалась пустой при живом портрете на устройстве.
- **[EN]** The portrait is uploaded to the cloud from the database rather than from that copy. The copy could be empty when the sync queue reached the task, which is why the cloud column stayed empty while the portrait was alive on the device.
- **[RU]** Список данных, показываемый перед выходом, снова считает портрет: он искал его по имени, которого в приложении нет.
- **[EN]** The data inventory shown before signing out counts the portrait again: it was looking for a name that does not exist in the app.

## 0.8.28 — 2026-09-02

- **[RU]** Раздел «Обо мне» — портрет, грани, двери контакта и оба прохода пересчёта — пока виден только владельцу. Показывать его людям рано: обновление профиля стоит около 125 обращений к ИИ на архиве в полторы сотни заметок, при обычном дневном лимите оно недостижимо, и оно не возобновляемое — упёршись в лимит на четвёртом шаге из шести, оставляет портрет несобранным. Кнопка, которая доводит до половины и бросает, хуже отсутствующей. Разбор отдельной заметки, поиск по смыслу и карточки работают у всех по-прежнему.
- **[EN]** The "About me" section — portrait, facets, contact doors and both recompute passes — is owner-only for now. Showing it to people is premature: refreshing the profile costs about 125 AI calls on an archive of a hundred and fifty notes, it is unreachable under an ordinary daily limit, and it does not resume — hitting the limit on step four of six leaves the portrait unbuilt. A button that reliably gets halfway and quits is worse than no button. Analysing a single note, semantic search and cards are unchanged for everyone.

## 0.8.27 — 2026-09-02

- **[RU]** Поисковые векторы уезжают в облако и с ручной выгрузки. Постоянный номер заметки подставлялся у двух путей выгрузки из трёх, а третий — кнопка «Отправить разбор и диалоги в облако» — брал запись из хранилища как есть, и база отклоняла её по правам доступа: 114 отказов за один заход. Теперь номер достаётся в самой точке выгрузки, через которую идут все три пути.
- **[EN]** Search vectors reach the cloud from the manual upload too. The note's permanent id was resolved in two of the three upload paths; the third — the "Upload analysis and dialogues" button — took records from storage as they were, and the database refused them on access rights: 114 refusals in a single run. The id is now resolved at the upload point itself, where all three paths meet.
- **[RU]** Вектор, за которым не осталось заметки, считается пропуском, а не сбоем — как и разбор без заметки.
- **[EN]** A vector whose note no longer exists counts as a skip, not a failure — same as an analysis without its note.

## 0.8.26 — 2026-09-02

- **[RU]** Разбор, за которым не осталось заметки, больше не считается сбоем выгрузки. Такие разборы отправить нельзя — база не примет строку без заметки, — но это пропуск, а не ошибка: успешный проход заканчивался пачкой красных сообщений, и выглядело это так, будто ничего не выгрузилось. Теперь они считаются отдельно и названы своим именем.
- **[EN]** An analysis whose note no longer exists is no longer counted as an upload failure. Such analyses cannot be sent — the database will not accept a row without its note — but that is a skip, not an error: a successful run ended in a pile of red messages that read as if nothing had been uploaded. They are now counted separately and named for what they are.

## 0.8.25 — 2026-09-02

- **[RU]** Разборы заметок снова уезжают в облако. Сводка отправлялась под локальным номером заметки вместо постоянного, база такую строку отклоняла, а повтора не было ни при разборе, ни в ручной выгрузке — и разборы оставались жить ровно в одном браузере: на устройстве их 166, в облаке было 26. Та же ошибка была исправлена для поисковых векторов в 0.8.22, но сводки ходят своей дорогой и остались с ней.
- **[EN]** Note analyses reach the cloud again. A summary was sent under the note's local number instead of its permanent one, the database refused the row, and nothing retried — on write or in the manual upload — so analyses lived in exactly one browser: 166 on the device, 26 in the cloud. The same bug was fixed for search vectors in 0.8.22, but summaries travel their own path and kept it.
- **[RU]** Выгрузка, которой не подо что подставить постоянный номер, теперь отказывает громко, а не отчитывается успехом за строки, которых в облаке не появилось.
- **[EN]** An upload with no permanent id to use now refuses loudly instead of reporting success for rows that never reached the cloud.

## 0.8.24 — 2026-09-02

- **[RU]** Отказы ИИ снова называются своими именами. После переезда на свой сервер приложение сверяло коды отказа со старым, firebase'овским форматом, а сервер шлёт новый — и «подождите минуту», «лимит на сегодня исчерпан» и «нет авторизации» все до единого превращались в «сбой сервиса». Из-за этого разбор архива обрывался на первом же ограничении частоты вместо того, чтобы его переждать.
- **[EN]** AI refusals are called by their right names again. After the move to our own server the app compared refusal codes against the old Firebase format while the server sends the new one — so "wait a minute", "daily limit reached" and "not authorised" all turned into "service failure". That is why analysing the archive died at the first rate limit instead of waiting it out.
- **[RU]** Разбор архива пережидает ограничение частоты вместо того, чтобы падать. Цену заметки нельзя посчитать заранее: каждое обязательство из неё векторизуется отдельным запросом, и на живом архиве вышло около восьми обращений на заметку вместо двух. Заметка, чья сводка сохранилась, а вектор не дался, второй раз не оплачивается — вектор досчитывается отдельным заходом в конце.
- **[EN]** Analysing the archive waits out a rate limit instead of dying on it. A note's cost cannot be computed in advance: every commitment in it is vectorised by its own request, which came to about eight calls per note instead of two. A note whose summary landed but whose vector did not is never paid for twice — the vector is caught up in a separate pass at the end.
- **[RU]** Окно перед разбором показывает, почему заметок в очереди меньше, чем в архиве: сколько их всего на этом устройстве, сколько уже разобрано, у скольких текста на устройстве нет, сколько слишком коротких и сколько исключено из ИИ.
- **[EN]** The dialogue before a run shows why the queue is shorter than the archive: how many notes are on this device, how many are already analysed, how many have no text here, how many are too short and how many are excluded from AI.

## 0.8.23 — 2026-09-02

- **[RU]** Кнопка «Разобрать заметки» в профиле: разбирает весь архив подряд, а не по одной записи. До неё разбор запускался только вручную на конкретной заметке, и накопить корпус для памяти было нечем — из 170 заметок разобранными оказались 17, а портрету нужно хотя бы 20. Проход возобновляемый: упёрся в дневной лимит — продолжает со следующего нажатия, уже разобранное второй раз не отправляет.
- **[EN]** An "Analyse notes" button in the profile: it works through the whole archive instead of one note at a time. Before it, analysis could only be started by hand on a single note, so the corpus the memory feeds on never accumulated — 17 of 170 notes were analysed, and the portrait needs at least 20. The run resumes: when it hits the daily limit it continues on the next press, and never re-sends what is already done.
- **[RU]** Разбор заметки больше не отчитывается успехом, когда вектор посчитать не удалось. Ошибка была не видна снаружи, и проход по архиву мог добрать остаток дневного лимита сводками, к которым векторов уже не будет.
- **[EN]** Analysing a note no longer reports success when its vector could not be computed. The failure was invisible from outside, and a run through the archive could spend the rest of the daily allowance on summaries whose vectors would never arrive.

## 0.8.22 — 2026-08-29

- **[RU]** Поисковые векторы заметок снова уходят в облако. Они отправлялись под локальным номером заметки вместо постоянного, сервер такую запись отклонял, а приложение пробовало снова при каждой фоновой синхронизации — и заполняло журнал одной и той же ошибкой.
- **[EN]** Note search vectors reach the cloud again. They were sent under a note's local number instead of its permanent one, the server refused the row, and the app retried on every background sync — filling the journal with the same error over and over.
- **[RU]** Долговременная память из разговоров снова извлекается. Ограничение на длину диалога было записано в трёх местах разными числами, и всё, что длиннее тридцати реплик, отклонялось целиком — то есть память переставала пополняться именно у тех, кто разговаривает много.
- **[EN]** Long-term memory from conversations is extracted again. The dialogue length limit was written in three places with three different numbers, and anything past thirty turns was refused outright — so memory stopped growing precisely for those who talk the most.

## 0.8.21 — 2026-08-28

- **[RU]** Приложение стало легче на старте: разбор заметок, поисковый указатель и индексатор больше не загружаются при открытии — только когда действительно нужны. Раньше их получал каждый, даже если ни разу не открывал ИИ.
- **[EN]** The app is lighter at startup: note analysis, the search index and the indexer no longer load when you open it — only when they are actually needed. Everyone used to receive them, even readers who never opened the AI at all.
- **[RU]** Внутренняя перестройка границ между частями приложения. Для читателя ничего не меняется; это цена будущих правок, а не сегодняшних.
- **[EN]** Internal rework of the boundaries between parts of the app. Nothing changes for the reader; this pays for future edits, not today's.

## 0.8.20 — 2026-08-28

- **[RU]** Диагностика, обозреватель базы, грани профиля и стенд ранжирования переведены на английский наравне с русским — около ста двадцати надписей, которые раньше были только по-русски. Эти страницы видит владелец, но язык интерфейса теперь один во всём приложении.
- **[EN]** Diagnostics, the database explorer, profile facets and the ranking bench are now available in English as well as Russian — about a hundred and twenty labels that used to exist only in Russian. These pages are owner-facing, but the interface language is now consistent across the whole app.
- **[RU]** Внутренняя перестройка: страница чата и сборка контекста разложены по отдельным частям вместо двух файлов на тысячу строк каждый. Для человека ничего не меняется — это цена будущих правок, а не сегодняшних.
- **[EN]** Internal rework: the chat page and the context builder are split into separate parts instead of two thousand-line files. Nothing changes for the reader — this pays for future edits, not today's.
- **[RU]** Сравнение размера сборки в проверках снова говорит правду: из-за ошибки в разборе имён все служебные части приложения считались одной и той же, и отчёт показывал несуществующий рост на сотни процентов.
- **[EN]** The build-size comparison in the checks tells the truth again: a name-parsing bug made all vendor chunks look like the same one, so the report showed non-existent growth of hundreds of percent.

## 0.8.19 — 2026-08-25

- **[RU]** Импортированная заметка больше не появляется в архиве дважды. Рядом с настоящей возникала пустая копия с тем же названием, и её приходилось удалять руками: импорт отправляет заметку в облако не дожидаясь ответа, а список в этот момент ещё не знал, что облачная строка и локальная заметка — одно и то же.
- **[EN]** An imported note no longer appears twice in the archive. An empty copy with the same title showed up next to the real one and had to be deleted by hand: import sends the note to the cloud without waiting, and at that moment the list did not yet know the cloud row and the local note were the same thing.
- **[RU]** В заголовке группы по дате снова стоит число заметок. Вместо него показывалась служебная строка — перевод для этого счётчика забыли добавить, когда его вводили.
- **[EN]** The date-group header shows the note count again. A technical string was displayed instead: the translation for that counter was never added when it was introduced.
- **[RU]** Сохранение заметки в файл больше не пишет в журнал ошибку. Файл сохранялся как надо, но браузер отказывал в системном окне «Поделиться», и этот отказ записывался как сбой — хотя экспорт удавался.
- **[EN]** Saving a note to a file no longer writes an error to the journal. The file saved fine, but the browser refused the system share sheet and that refusal was recorded as a failure — while the export had actually succeeded.

## 0.8.18 — 2026-08-25

- **[RU]** Дневной остаток запросов к ИИ теперь приходит с сервера, а не считается в браузере. Раньше число жило только на этом устройстве: после восстановления архива или во второй вкладке оно расходилось с настоящим, а у администратора показывалось втрое меньше, чем разрешено на самом деле.
- **[EN]** The daily AI request allowance now comes from the server instead of being counted in the browser. The number used to live on this device only: after restoring the archive or in a second tab it drifted from the real one, and an administrator saw a third of what is actually allowed.
- **[RU]** Все диалоги и мобильные шторки переведены на общий каркас: фокус клавиатуры удерживается внутри окна, Escape закрывает, экранный диктор объявляет их одинаково. Пятнадцать окон повторяли это вручную — часть с ошибками, часть не повторяла вовсе.
- **[EN]** Every dialog and mobile sheet now uses one shell: keyboard focus stays inside, Escape closes, and a screen reader announces them consistently. Fifteen dialogs repeated this by hand — some incorrectly, some not at all.
- **[RU]** Сообщения об ошибках приведены к одной форме. Приложение продолжает понимать и прежнюю, поэтому вкладка, открытая до обновления, не перестанет отличать «дневной лимит исчерпан» от «сервер недоступен».
- **[EN]** Error responses now share one shape. The app still understands the previous one, so a tab opened before the update keeps telling "daily limit reached" apart from "server unavailable".

## 0.8.17 — 2026-08-25

- **[RU]** Уход из разговора посреди ответа больше не стоит запроса. Если закрыть вкладку, уйти на другую страницу или нажать «назад», пока ассистент печатает, запрос возвращается в дневной остаток, а модель перестаёт досчитывать ответ, который никто не прочитает. Раньше это работало только в режиме с рассуждениями, а в обычном разговоре — самом частом — не работало вовсе.
- **[EN]** Leaving a conversation mid-answer no longer costs a request. Closing the tab, navigating away or going back while the assistant is typing returns the request to the daily allowance and stops the model from finishing an answer nobody will read. This used to work only in reasoning mode and not at all in ordinary conversation — the most common one.
- **[RU]** Заметка больше не может управлять ассистентом. Если в вашем тексте случайно встречалось служебное слово, которым помечена граница данных, всё написанное после него читалось как указание ассистенту. Теперь текст заметки остаётся текстом заметки при любом содержимом — включая варианты с невидимыми символами внутри слова.
- **[EN]** A note can no longer steer the assistant. If your text happened to contain the internal word that marks the data boundary, everything after it was read as an instruction. A note's text now stays a note's text whatever it contains — including variants with invisible characters inside the word.
- **[RU]** Модальные окна и мобильные шторки переведены на общий каркас: фокус клавиатуры удерживается внутри окна, Escape закрывает, экранный диктор объявляет их одинаково. Раньше каждое окно повторяло это вручную, и часть окон обходилась без.
- **[EN]** Dialogs and mobile sheets now share one shell: keyboard focus stays inside, Escape closes, and a screen reader announces them consistently. Each dialog used to repeat this by hand, and some skipped it entirely.
- **[RU]** Перевод старого шифрования на новое записывает число проходов защиты в сам сейф — как это уже делают создание сейфа и смена пароля. Ошибка в пароле перестала обходиться вдвое дольше на таких сейфах.
- **[EN]** Migrating the old encryption to the new one now records the number of protection passes in the vault itself, as vault creation and password change already do. A wrong password no longer takes twice as long on those vaults.
- **[RU]** Проверка после выкатки снова выполняется. Она молча пропускалась при каждой выкатке из-за незаданных настроек и рапортовала об успехе; теперь без них выкатка останавливается прежде, чем что-либо уедет на сервер, а сама проверка испытывает оба режима разговора.
- **[EN]** The post-deploy check runs again. It had been silently skipping on every deploy because of unset settings and reporting success; now a deploy stops before anything reaches the server, and the check exercises both conversation modes.

## 0.8.16 — 2026-08-24

- **[RU]** Заметка больше не расходится в двух копиях при одновременной работе в двух вкладках. Загрузка в облако обычно длится дольше, чем держалась блокировка, и вторая вкладка проходила её как «просроченную» — теперь блокировка продлевается, пока работа идёт.
- **[EN]** A note no longer splits into two copies when two tabs work at once. An upload usually outlives the lock that guarded it, and the second tab walked past it as "expired" — the lock is now extended for as long as the work runs.
- **[RU]** Расхождение версий определяется по базовой версии, а не по совпадению текста. Две правки от одной основы больше не заканчиваются молчаливой потерей первой из них.
- **[EN]** Version divergence is decided by the base version, not by matching text. Two edits from the same base no longer end with the first one silently overwritten.
- **[RU]** При расхождении в копию попадают все несохранённые версии, а не только последняя, и одна синхронизация делает одну копию вместо цепочки. У копии в названии время и начало текста — их стало можно различить.
- **[EN]** On divergence the copy now carries every unsynced version, not just the latest, and one sync makes one copy instead of a chain. The copy's name carries the time and the opening words, so they can be told apart.
- **[RU]** Неудачная загрузка больше не стирает уже отправленные версии: следующая попытка продолжает с места обрыва, а не начинает с нуля.
- **[EN]** A failed upload no longer erases the versions already sent: the next attempt resumes where it stopped instead of starting over.
- **[RU]** Задача синхронизации, которая не может завершиться никогда, уходит в карантин после нескольких попыток вместо вечного повтора, а упавшая выгрузка возвращается в очередь. Молча потерянных заметок нет.
- **[EN]** A sync task that can never succeed is quarantined after a few attempts instead of retrying forever, and a failed upload returns to the queue. No note is silently lost.
- **[RU]** Заметка, случайно совпавшая с подозрительным образцом текста, больше не роняет весь разговор с ИИ. Собственные записи теперь ограждаются как данные, а не отклоняются; отклоняются по-прежнему только сами сообщения в чате.
- **[EN]** A note that happens to match a suspicious text pattern no longer breaks the whole AI conversation. Your own entries are now fenced as data rather than rejected; only chat messages themselves are still refused.
- **[RU]** Приложение стало легче: удалена библиотека графиков, которой никто не пользовался, и выгрузка в Word подгружается только когда её просят.
- **[EN]** The app got lighter: an unused charting library is gone, and Word export loads only when asked for.
- **[RU]** Отмена и повтор возвращают курсор туда, где он был, а не в конец текста.
- **[EN]** Undo and redo put the cursor back where it was instead of at the end of the text.
- **[RU]** Ошибка при вводе пароля от сейфа перестала занимать вдвое больше времени: число проходов теперь записано в самом сейфе, а не подбирается.
- **[EN]** A typo in the vault password no longer takes twice as long: the number of passes is recorded in the vault itself instead of being guessed.
- **[RU]** Если обновление локальной базы заблокировано другой вкладкой, приложение теперь так и говорит, а не оставляет гадать.
- **[EN]** When a local database upgrade is blocked by another tab, the app now says so instead of leaving you to guess.
- **[RU]** Мобильные шторки удерживают фокус клавиатуры и закрываются по Escape, как остальные окна.
- **[EN]** Mobile sheets now trap keyboard focus and close on Escape, like every other dialog.
- **[RU]** Возврат средств за прерванный разговор списывается с того дня, за который заплатили: запрос около полуночи больше не чинит счётчик соседних суток.
- **[EN]** A refund for an interrupted conversation now lands on the day that was charged: a request near midnight no longer credits the neighbouring day.
- **[RU]** Большой архив в режиме группировки по датам перестал отрисовываться целиком и переключается на постраничный показ.
- **[EN]** A large archive grouped by date no longer renders in full and switches to a windowed view.
- **[RU]** Размер приложения теперь проверяется на сборке жёстким порогом, а не только сравнением с предыдущей версией.
- **[EN]** App size is now checked at build time against a hard ceiling, not only compared with the previous version.

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
