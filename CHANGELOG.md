# Changelog

## 0.8.43 — 2026-09-11

- **[RU]** Черновик при включённом сейфе не доходил до облака, если заголовок длиннее ~60 кириллических символов или текст больше ~37 тысяч: шифротекст не проходил ограничение базы, второе устройство видело старый черновик. Ограничение расширено, а постоянный отказ теперь виден в значке редактора, а не только в журнале.
- **[EN]** A draft with the vault on could not reach the cloud once its title passed ~60 Cyrillic characters or its text ~37k: the ciphertext exceeded a database limit and the second device saw the old draft. The limit is raised, and a permanent refusal now shows in the editor badge instead of only the log.
- **[RU]** «Удалить все данные ИИ» теперь удаляет на сервере то, что обещало: эмбеддинги, конспекты и зеркала локальных хранилищ. Раньше очищалось только устройство, а сообщение говорило, что удалено всё.
- **[EN]** “Delete all AI data” now deletes on the server what it promised: embeddings, summaries and the mirrored local stores. Before, only the device was cleared while the message said everything was gone.
- **[RU]** Заметка без текста на устройстве больше не выгружается файлом с заголовком и пустым телом — экспорт отказывает и объясняет почему. «В этот день» сохраняет совпадение и пишет «заблокировано» или «не загружено» вместо пустого отрывка.
- **[EN]** A note with no text on the device can no longer be exported as a file with a header and an empty body — export refuses and says why. “On this day” keeps the match and says “locked” or “not loaded” in place of an empty excerpt.
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
