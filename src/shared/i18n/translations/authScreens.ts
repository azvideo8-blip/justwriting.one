import { Translations } from '../types';

// Экраны согласия, выхода и сброса пароля (B-3.2). Ленивое пространство:
// ни один из них не нужен первому экрану, а их тексты (юридическое согласие на
// двух языках) — 11 КБ в стартовом куске, сверх бюджета CI.
export const authScreensTranslations: Translations = {
  privacy_consent_intro: {
    ru: 'justwriting — приватный редактор для свободного письма. Вот как мы обращаемся с вашими данными:',
    en: 'justwriting is a private editor for free writing. Here is how we handle your data:',
  },
  privacy_consent_storage_title: {
    ru: 'Как хранятся данные',
    en: 'How data is stored',
  },
  privacy_consent_storage_p1_before: {
    ru: 'Заметки хранятся на вашем устройстве. Если включена синхронизация, копия уезжает на наш сервер в России — ',
    en: 'Notes are stored on your device. If sync is enabled, a copy is sent to our server in Russia — ',
  },
  privacy_consent_storage_p1_strong: {
    ru: 'содержимое, заголовки и теги зашифрованы',
    en: 'content, titles, and tags are encrypted',
  },
  privacy_consent_storage_p1_after: {
    ru: ' ключом, который выводится из вашего пароля и на сервер не попадает. Открытыми остаются только даты, длительность сессий и счётчики слов.',
    en: ' with a key derived from your password that never reaches the server. Only dates, session durations, and word counts remain unencrypted.',
  },
  privacy_consent_storage_p2: {
    ru: 'Аналитики, счётчиков и отправки ошибок посторонним сервисам нет.',
    en: 'There are no analytics, trackers, or error telemetry sent to third-party services.',
  },
  privacy_consent_storage_p3: {
    ru: 'Удаление аккаунта удаляет заметки, историю и всё, что было по ним посчитано.',
    en: 'Deleting your account deletes notes, history, and all computed metadata.',
  },
  privacy_consent_third_party_title: {
    ru: 'Что уходит третьим лицам',
    en: 'What is shared with third parties',
  },
  privacy_consent_third_party_p1_before: {
    ru: 'Текст уходит поставщику ИИ ',
    en: 'Text is sent to the AI provider ',
  },
  privacy_consent_third_party_p1_strong: {
    ru: 'только когда вы пользуетесь ИИ',
    en: 'only when you actively use AI features',
  },
  privacy_consent_third_party_p1_after: {
    ru: ': нажимаете разбор у заметки, отправляете сообщение в чате или просите ИИ-помощника. Вместе с ответом в чате приложение делает несколько служебных запросов с тем же разговором — придумывает название диалога, предлагает подсказки и сохраняет факты в «Память ИИ» (подсказки и память можно выключить в настройках). Без ваших действий тексты не отправляются.',
    en: ': when you request note analysis, send a message in chat, or ask the AI assistant. Along with the chat response, the app makes several auxiliary requests with the same conversation — generating a dialogue title, suggesting follow-ups, and saving facts to "AI Memory" (suggestions and memory can be disabled in settings). No text is sent without your explicit action.',
  },
  privacy_consent_third_party_p2: {
    ru: 'Поставщик — RouterAI (Россия). Он не хранит содержимое запросов, но по умолчанию может передать запрос зарубежному сервису, который вычисляет ответ и таких гарантий не даёт.',
    en: 'The provider is RouterAI (Russia). It does not store request contents, but by default it may route requests to overseas services that compute responses and do not provide such guarantees.',
  },
  privacy_consent_third_party_p3: {
    ru: 'Голосовой ввод (диктовка) использует встроенное распознавание речи браузера: аудиозапись передаётся серверам вендора браузера (Google или Apple) для перевода в текст. Если вы вошли в аккаунт и согласились на обработку ИИ, распознанный текст затем отправляется нашему ИИ-сервису, чтобы расставить знаки препинания; слова при этом не меняются.',
    en: 'Voice input (dictation) uses browser-native speech recognition: audio recordings are transmitted to browser vendor servers (Google or Apple) for speech-to-text transcription. If you are signed in and have agreed to AI processing, the recognised text is then sent to our AI service to add punctuation; the words are not changed.',
  },
  privacy_consent_third_party_p4: {
    ru: 'Если в заметке упомянуты другие люди, их слова и обстоятельства уходят вместе с текстом. Отдельной картотеки упомянутых людей приложение не ведёт.',
    en: 'If other people are mentioned in a note, their words and circumstances are sent along with the text. The app does not maintain a separate index of mentioned individuals.',
  },
  privacy_consent_links_prefix: {
    ru: 'Подробнее: ',
    en: 'Learn more: ',
  },
  // MC-6: три полноэкранных шага первого входа на телефоне. Пустили — то же
  // согласие и те же записи, что окна, только крупнее и по одному за раз.
  first_run_step: { ru: 'Шаг {current} из {total}', en: 'Step {current} of {total}' },
  first_run_policy_title: { ru: 'Что происходит с вашим текстом', en: 'What happens to your text' },
  first_run_policy_link: { ru: 'Читать политику полностью', en: 'Read the full policy' },
  first_run_policy_link_close: { ru: 'Свернуть политику', en: 'Hide the full policy' },
  first_run_next: { ru: 'Дальше', en: 'Next' },
  first_run_cloud_title: { ru: 'Облако', en: 'Cloud' },
  first_run_sync_switch: { ru: 'Синхронизация с облаком', en: 'Sync with the cloud' },
  first_run_restore_switch_one: { ru: 'Загрузить {count} заметку из облака', en: 'Download {count} note from the cloud' },
  first_run_restore_switch_few: { ru: 'Загрузить {count} заметки из облака', en: 'Download {count} notes from the cloud' },
  first_run_restore_switch_many: { ru: 'Загрузить {count} заметок из облака', en: 'Download {count} notes from the cloud' },
  first_run_finish: { ru: 'Начать писать', en: 'Start writing' },
  first_run_skip: { ru: 'Пропустить', en: 'Skip' },
  privacy_consent_privacy_policy: {
    ru: 'Политика конфиденциальности',
    en: 'Privacy Policy',
  },
  privacy_consent_and: {
    ru: ' и ',
    en: ' and ',
  },
  privacy_consent_terms: {
    ru: 'Условия использования',
    en: 'Terms of Service',
  },
  privacy_consent_required_label: {
    ru: 'Обязательно: ',
    en: 'Required: ',
  },
  privacy_consent_accept_before: {
    ru: 'Я прочитал и принимаю ',
    en: 'I have read and accept the ',
  },
  privacy_consent_data_policy: {
    ru: 'Политику обработки персональных данных',
    en: 'Personal Data Processing Policy',
  },
  privacy_consent_ai_label: {
    ru: 'Необязательно, для функций ИИ: ',
    en: 'Optional, for AI features: ',
  },
  privacy_consent_ai_text_before: {
    ru: 'Я даю ',
    en: 'I give ',
  },
  privacy_consent_ai_link: {
    ru: 'согласие на обработку специальных категорий персональных данных',
    en: 'consent to the processing of special categories of personal data',
  },
  privacy_consent_ai_text_after: {
    ru: ' — сведений о состоянии здоровья, психоэмоциональном состоянии и личной жизни, которые могут содержаться в моих записях, — для работы функций ИИ. Без этого согласия письмо и хранение записей остаются доступными, функции ИИ — нет',
    en: ' — information concerning health, psycho-emotional state, and private life that may be contained in my entries — for AI functionality. Without this consent, writing and local storage remain fully available, while AI features do not',
  },

  // SignOutConfirmModal
  // S-28: предложение стереть данные аккаунта на устройстве, где вход оборвался
  // не по воле человека. Формулировка не утверждает, что аккаунт удалён, —
  // отличить это от отозванной сессии нельзя.
  auth_lost_session_wipe_hint: {
    ru: 'Вход в аккаунт с этого устройства оборвался, его локальная копия заметок осталась. Удалить её?',
    en: 'Sign-in to your account on this device ended unexpectedly, but its local copy of notes is still here. Delete it?',
  },
  auth_lost_session_wipe_button: {
    ru: 'Удалить данные с этого устройства',
    en: 'Delete data from this device',
  },
  // S-33: подтверждение называет, что уходит, и предупреждает о несинхронизированном.
  auth_lost_session_wipe_confirm_title: {
    ru: 'Удалить данные с этого устройства?',
    en: 'Delete data from this device?',
  },
  auth_lost_session_wipe_confirm_message: {
    ru: 'Будут удалены заметки, разборы и настройки этого аккаунта на этом устройстве, а также гостевые заметки и черновик этого браузера. Данные других аккаунтов на устройстве и копия в облаке (если аккаунт существует) не затрагиваются.',
    en: 'This deletes this account’s notes, analyses and settings on this device, plus this browser’s guest notes and draft. Other accounts’ data on this device and the cloud copy (if the account still exists) are not affected.',
  },
  auth_lost_session_wipe_confirm_unsynced: {
    ru: 'Внимание: {count} несинхронизированных записей не попали в облако — они будут потеряны навсегда.',
    en: 'Warning: {count} unsynced items never reached the cloud — they will be lost for good.',
  },
  auth_lost_session_wipe_done: {
    ru: 'Данные этого аккаунта удалены с устройства',
    en: 'This account’s data was deleted from this device',
  },
  auth_lost_session_wipe_failed: {
    ru: 'Не удалось удалить данные с устройства — очистите данные сайта в браузере вручную',
    en: 'Could not delete the data from this device — clear this site’s data in your browser manually',
  },
  signout_unsynced_error: {
    ru: 'Есть несинхронизированные данные. Подтвердите принудительное удаление или отмените выход.',
    en: 'There is unsynced data. Confirm forced deletion or cancel sign-out.',
  },
  signout_title: {
    ru: 'Выход из аккаунта',
    en: 'Sign out of account',
  },
  signout_clear_checkbox_label: {
    ru: 'Это чужой компьютер — удалить все данные',
    en: 'This is a shared computer — delete all data',
  },
  signout_clear_checkbox_hint: {
    ru: 'Полностью очистить браузерное хранилище (IndexedDB) на этом устройстве.',
    en: 'Completely clear browser storage (IndexedDB) on this device.',
  },
  signout_local_preserved_title: {
    ru: 'Локальные записи сохраняются',
    en: 'Local entries are preserved',
  },
  signout_local_preserved_desc: {
    ru: 'Заметки останутся в браузере на этом устройстве. Ключ сейфа выгружен из памяти, сессия завершена. При следующем входе потребуется пароль для расшифровки.',
    en: 'Notes will remain in the browser on this device. The vault key is unloaded from memory and your session is terminated. You will need your password to decrypt on your next sign-in.',
  },
  signout_wipe_inventory_title: {
    ru: 'Будет удалено с этого устройства:',
    en: 'Will be removed from this device:',
  },
  signout_counting_inventory: {
    ru: 'Подсчет локальных данных...',
    en: 'Counting local data...',
  },
  signout_inv_notes: {
    ru: 'Заметок: ',
    en: 'Notes: ',
  },
  signout_inv_versions: {
    ru: 'Версий: ',
    en: 'Versions: ',
  },
  signout_inv_dialogues: {
    ru: 'Диалогов: ',
    en: 'Dialogues: ',
  },
  signout_inv_facets: {
    ru: 'Граней профиля: ',
    en: 'Profile facets: ',
  },
  signout_inv_life_story: {
    ru: 'История жизни: ',
    en: 'Life story: ',
  },
  signout_inv_themes: {
    ru: 'Реестр тем: ',
    en: 'Theme ledger: ',
  },
  signout_inv_beliefs: {
    ru: 'Убеждений: ',
    en: 'Beliefs: ',
  },
  signout_inv_portrait: {
    ru: 'Портрет: ',
    en: 'Portrait: ',
  },
  signout_yes: {
    ru: 'да',
    en: 'yes',
  },
  signout_no: {
    ru: 'нет',
    en: 'no',
  },
  signout_unsynced_warning_title: {
    ru: 'Внимание: несинхронизированные данные',
    en: 'Warning: unsynced data',
  },
  signout_unsynced_warning_desc_before: {
    ru: 'Найдено ',
    en: 'Found ',
  },
  signout_unsynced_warning_desc_after: {
    ru: ' несинхронизированных правок. При удалении локальных данных они будут потеряны навсегда.',
    en: ' unsynced edits. If you delete local data, they will be permanently lost.',
  },
  signout_force_wipe_label: {
    ru: 'Я понимаю риски и хочу удалить данные без отправки в облако',
    en: 'I understand the risks and want to delete data without uploading to the cloud',
  },
  signout_btn_wipe: {
    ru: 'Выйти и удалить всё',
    en: 'Sign out and delete all',
  },
  signout_btn: {
    ru: 'Выйти',
    en: 'Sign out',
  },

  // ResetPasswordPage
  reset_pw_other_account: {
    ru: 'другой аккаунт',
    en: 'another account',
  },
  reset_pw_min_length: {
    ru: 'Минимум {count} символов',
    en: 'Minimum {count} characters',
  },
  reset_pw_mismatch: {
    ru: 'Пароли не совпадают',
    en: 'Passwords do not match',
  },
  reset_pw_offline: {
    ru: 'Нет соединения с сетью. Проверьте подключение и попробуйте снова.',
    en: 'No network connection. Check your connection and try again.',
  },
  reset_pw_failed: {
    ru: 'Не удалось изменить пароль. Ссылка могла устареть — запросите новую.',
    en: 'Failed to change password. The link may have expired — request a new one.',
  },
  reset_pw_checking_signin: {
    ru: 'Проверяю, выполнен ли вход…',
    en: 'Checking sign-in status…',
  },
  reset_pw_switch_title_signed_in: {
    ru: 'Сейчас выполнен вход в другой аккаунт',
    en: 'Currently signed in to another account',
  },
  reset_pw_switch_title_unknown: {
    ru: 'Возможно, выполнен вход в другой аккаунт',
    en: 'Possibly signed in to another account',
  },
  reset_pw_switch_desc_account_before: {
    ru: 'В этом браузере открыт аккаунт ',
    en: 'This browser is signed in to ',
  },
  reset_pw_switch_desc_account_after: {
    ru: '. ',
    en: '. ',
  },
  reset_pw_switch_desc_unknown: {
    ru: 'Не удалось проверить, открыт ли в этом браузере другой аккаунт. ',
    en: 'Could not verify whether another account is open in this browser. ',
  },
  reset_pw_switch_desc_body: {
    ru: 'Приглашение создаёт новый аккаунт, и из текущего придётся выйти — во всех вкладках. Ваши заметки и черновик останутся в нём, войти обратно можно в любой момент.',
    en: 'The invitation creates a new account, and you will need to sign out of the current one across all tabs. Your notes and draft will remain in it, and you can sign back in at any time.',
  },
  reset_pw_switch_btn_stay: {
    ru: 'Остаться',
    en: 'Stay',
  },
  reset_pw_switch_btn_continue: {
    ru: 'Продолжить',
    en: 'Continue',
  },
  reset_pw_title_invite: {
    ru: 'Задайте пароль',
    en: 'Set a password',
  },
  reset_pw_title_recovery: {
    ru: 'Восстановление пароля',
    en: 'Password recovery',
  },
  reset_pw_legacy_hash_warning: {
    ru: 'Ссылка из письма имеет устаревший формат (implicit hash). Запросите новую ссылку или откройте её повторно.',
    en: 'The link from the email has an outdated format (implicit hash). Please request a new link or reopen it.',
  },
  reset_pw_btn_go_to_login: {
    ru: 'Перейти ко входу',
    en: 'Go to sign in',
  },
  reset_pw_invite_used_message: {
    ru: 'Эта ссылка-приглашение уже использована. Если вы задали пароль — просто войдите. Если не успели — попросите новое приглашение у того, кто вас пригласил.',
    en: 'This invitation link has already been used. If you set a password, just sign in. If you didn’t get to it, ask whoever invited you for a new invitation.',
  },
  // V-1.2: начатую настройку нельзя продолжить в другом браузере — ссылка обменена там, где её открыли первой.
  reset_pw_invite_used_other_browser: {
    ru: 'Если вы начали настройку в другом браузере или на другом устройстве — вернитесь туда и завершите её там.',
    en: 'If you started the setup in another browser or on another device, go back there and finish it there.',
  },
  // V-1.3: вход по ссылке потерялся — это не «нет сети».
  reset_pw_session_lost: {
    ru: 'Вход по ссылке потерялся. Откройте ссылку из письма ещё раз; если она уже использована — попросите новую.',
    en: 'The sign-in from the link was lost. Open the link from the email again; if it has already been used, ask for a new one.',
  },
  reset_pw_link_expired_message: {
    ru: 'Ссылка уже использована или устарела — запросите новую',
    en: 'The link has already been used or has expired — please request a new one',
  },
  reset_pw_btn_request_new_link: {
    ru: 'Запросить новую ссылку',
    en: 'Request new link',
  },
  reset_pw_direct_visit_hint: {
    ru: 'Откройте эту страницу по ссылке из письма. Если вы перешли напрямую — запросите восстановление пароля на странице входа.',
    en: 'Open this page using the link from the email. If you navigated here directly, please request a password recovery on the sign-in page.',
  },
  reset_pw_encryption_important: {
    ru: 'Важно:',
    en: 'Important:',
  },
  reset_pw_encryption_warning_text: {
    ru: ' заметки зашифрованы прежним паролем. После входа с новым паролем приложение один раз попросит прежний пароль или код восстановления, который вы сохранили при первом входе, — и дальше у вас снова будет один пароль. Без прежнего пароля и кода зашифрованные заметки не открыть.',
    en: ' notes are encrypted with your previous password. After signing in with your new password, the app will ask once for your previous password or recovery code that you saved during your first sign-in — and then you will have a single password again. Without your previous password or code, encrypted notes cannot be opened.',
  },
  reset_pw_input_placeholder: {
    ru: 'Новый пароль',
    en: 'New password',
  },
  reset_pw_confirm_placeholder: {
    ru: 'Повторите пароль',
    en: 'Repeat password',
  },
  reset_pw_saving: {
    ru: 'Сохраняю…',
    en: 'Saving…',
  },
  reset_pw_submit: {
    ru: 'Сменить пароль',
    en: 'Change password',
  },
  reset_pw_done_message: {
    ru: 'Пароль изменён. Войдите с новым паролем.',
    en: 'Password changed. Sign in with your new password.',
  },

  // Privacy modal
  privacy_modal_title: {
    ru: 'Политика конфиденциальности',
    en: 'Privacy Policy',
  },
  privacy_modal_save_error: {
    ru: 'Не удалось сохранить согласие. Проверьте связь и попробуйте ещё раз.',
    en: 'Failed to save consent. Please check your connection and try again.',
  },
  privacy_modal_continue: {
    ru: 'Продолжить',
    en: 'Continue',
  },

  // Other user data modal
  other_user_data_title: {
    ru: 'Данные предыдущего пользователя',
    en: 'Previous user data',
  },
  other_user_data_desc_1: {
    ru: 'На этом устройстве обнаружены локальные записи предыдущей учётной записи.',
    en: 'Local entries from a previous account were found on this device.',
  },
  other_user_data_desc_2: {
    ru: 'Они изолированы и не видны в ваших заметках. Вы можете очистить их, чтобы освободить место на устройстве.',
    en: 'They are isolated and not visible in your notes. You can clear them to free up space on your device.',
  },
  other_user_data_btn_keep: {
    ru: 'Оставить',
    en: 'Keep',
  },
  other_user_data_btn_clear: {
    ru: 'Очистить чужие данные',
    en: 'Clear other data',
  },

  // Indexing consent modal
  indexing_consent_title: {
    ru: 'Поиск по смыслу (индексация)',
    en: 'Semantic search (indexing)',
  },
  indexing_consent_desc: {
    ru: 'Чтобы искать заметки не только по точным совпадениям слов, но и по смыслу и ассоциациям, приложению требуется построить числовой индекс (эмбеддинги).',
    en: 'To search notes not only by exact word matches, but also by meaning and association, the app needs to build a numerical index (embeddings).',
  },
  indexing_consent_data_title: {
    ru: 'Что происходит с данными:',
    en: 'What happens with data:',
  },
  indexing_consent_what_sent_title: {
    ru: 'Что отправляется:',
    en: 'What is sent:',
  },
  indexing_consent_what_sent_desc: {
    ru: 'Текст заметок отправляется частями модели эмбеддингов для построения смыслового поиска. Заметки с пометкой «не показывать ИИ» не индексируются.',
    en: 'Note text is sent in chunks to the embedding model to build semantic search. Notes marked "do not show to AI" are not indexed.',
  },
  indexing_consent_when_sent_title: {
    ru: 'Когда отправляется:',
    en: 'When it is sent:',
  },
  indexing_consent_when_sent_desc: {
    ru: 'когда вы запускаете разбор заметки, и один раз по всему архиву в момент включения поиска по смыслу. Само по себе письмо и сохранение заметки ничего не отправляют.',
    en: 'when you trigger note analysis, and once across the entire archive when semantic search is enabled. Writing and saving notes by themselves send nothing.',
  },
  indexing_consent_what_returned_title: {
    ru: 'Что возвращается:',
    en: 'What is returned:',
  },
  indexing_consent_what_returned_desc: {
    ru: 'Числовой вектор, который сохраняется в локальной базе устройства в зашифрованном виде.',
    en: 'A numerical vector that is stored in the device’s local database in encrypted form.',
  },
  indexing_consent_disabled_title: {
    ru: 'При отказе отключается:',
    en: 'Disabled if declined:',
  },
  indexing_consent_disabled_item_1: {
    ru: 'Поиск по смыслу и блок связанных мыслей',
    en: 'Semantic search and related thoughts block',
  },
  indexing_consent_disabled_item_2: {
    ru: 'Автоматический подбор заметок в диалогах',
    en: 'Automatic note suggestions in dialogues',
  },
  indexing_consent_disabled_item_3: {
    ru: 'Грани личности в профиле',
    en: 'Personality facets in profile',
  },
  indexing_consent_disabled_item_4: {
    ru: 'Смысловые цепочки заметок (ветки)',
    en: 'Semantic note chains (threads)',
  },
  indexing_consent_enabled_title: {
    ru: 'Продолжает работать:',
    en: 'Continues to work:',
  },
  indexing_consent_enabled_item_1: {
    ru: 'Поиск по точным ключевым словам',
    en: 'Exact keyword search',
  },
  indexing_consent_enabled_item_2: {
    ru: 'Ручной разбор отдельных заметок',
    en: 'Manual analysis of individual notes',
  },
  indexing_consent_enabled_item_3: {
    ru: 'Хронология и журнал тем',
    en: 'Timeline and theme ledger',
  },
  indexing_consent_enabled_item_4: {
    ru: 'Обязательства и цели',
    en: 'Commitments and goals',
  },
  indexing_consent_footer: {
    ru: 'Выбор можно изменить в любой момент в настройках аккаунта.',
    en: 'This choice can be changed at any time in account settings.',
  },
  indexing_consent_btn_words_only: {
    ru: 'Искать только по словам',
    en: 'Search words only',
  },
  indexing_consent_btn_enable: {
    ru: 'Включить поиск по смыслу',
    en: 'Enable semantic search',
  },

  // Invite wizard
  invite_wizard_step: {
    ru: 'Шаг {current} из {total}',
    en: 'Step {current} of {total}',
  },
  invite_wizard_welcome_title: {
    ru: 'Добро пожаловать в justwriting',
    en: 'Welcome to justwriting',
  },
  invite_wizard_welcome_desc: {
    ru: 'Спасибо, что решили попробовать мой проект. Это тихий редактор для свободного письма: пишете без оглядки, заметки хранятся у вас и шифруются, а ИИ помогает перечитать написанное — только когда вы сами его позовёте.',
    en: 'Thank you for trying my project. It is a quiet editor for free writing: write without second thoughts, notes are stored locally and encrypted, and AI helps reread what you wrote — only when you ask for it.',
  },
  invite_wizard_welcome_prompt: {
    ru: 'Сейчас пройдём три коротких шага, прежде чем начать',
    en: 'We will now take three quick steps before starting',
  },
  invite_wizard_for_email_prefix: {
    ru: '— для',
    en: '— for',
  },
  invite_wizard_btn_start: {
    ru: 'Начать',
    en: 'Start',
  },
  invite_wizard_policy_title: {
    ru: 'Как мы обращаемся с данными',
    en: 'How we handle data',
  },
  invite_wizard_password_title: {
    ru: 'Придумайте пароль',
    en: 'Create a password',
  },
  invite_wizard_login_label: {
    ru: 'Ваш логин:',
    en: 'Your login:',
  },
  invite_wizard_password_desc: {
    ru: 'Пароль нужен, чтобы входить, — и им же шифруются ваши заметки: без него их не прочитает никто, даже мы. Хранить заметки в облаке или только на этом устройстве, решите на следующем шаге.',
    en: 'The password is required to sign in — and it encrypts your notes: without it, nobody can read them, not even us. You will decide on the next step whether to store notes in the cloud or only on this device.',
  },
  invite_wizard_password_placeholder: {
    ru: 'Пароль',
    en: 'Password',
  },
  invite_wizard_confirm_placeholder: {
    ru: 'Повторите пароль',
    en: 'Repeat password',
  },
  invite_wizard_saving: {
    ru: 'Сохраняю…',
    en: 'Saving…',
  },
  invite_wizard_btn_next: {
    ru: 'Далее',
    en: 'Next',
  },
  invite_wizard_sync_title: {
    ru: 'Хранить заметки в облаке?',
    en: 'Store notes in the cloud?',
  },
  invite_wizard_sync_desc: {
    ru: 'С синхронизацией заметки попадают на наш сервер в зашифрованном виде — их можно открыть на другом устройстве, и они не пропадут вместе с этим. Без неё заметки живут только в этом браузере.',
    en: 'With sync enabled, notes are saved to our server in encrypted form — you can open them on another device, and they will not be lost with this one. Without it, notes live only in this browser.',
  },
  invite_wizard_sync_hint: {
    ru: 'Решение можно поменять в любой момент: Настройки → Синхронизация.',
    en: 'You can change this choice at any time: Settings → Sync.',
  },
  invite_wizard_btn_not_now: {
    ru: 'Не сейчас',
    en: 'Not now',
  },
  invite_wizard_btn_enable_sync: {
    ru: 'Включить',
    en: 'Enable',
  },
  invite_wizard_recovery_title: {
    ru: 'Сохраните код восстановления',
    en: 'Save your recovery code',
  },
  invite_wizard_recovery_desc: {
    ru: 'Если забудете пароль, этот код — единственный способ открыть заметки из облака. Мы его не храним и показываем один раз.',
    en: 'If you forget your password, this code is the only way to open notes from the cloud. We do not store it and show it only once.',
  },
  invite_wizard_copied: {
    ru: 'Скопировано',
    en: 'Copied',
  },
  invite_wizard_copy: {
    ru: 'Скопировать',
    en: 'Copy',
  },
  invite_wizard_download: {
    ru: 'Скачать',
    en: 'Download',
  },
  invite_wizard_download_file_content: {
    ru: 'Код восстановления justwriting\n\n{recoveryCode}\n\nОн нужен, если забудете пароль: без него зашифрованные заметки не открыть.\n',
    en: 'justwriting recovery code\n\n{recoveryCode}\n\nNeeded if you forget your password: without it, encrypted notes cannot be opened.\n',
  },
  invite_wizard_saved_checkbox: {
    ru: 'Я сохранил(а) код в надёжном месте',
    en: 'I have saved the code in a safe place',
  },
  invite_wizard_btn_start_writing: {
    ru: 'Начать писать',
    en: 'Start writing',
  },
  invite_wizard_btn_back: {
    ru: 'Назад',
    en: 'Back',
  },
  invite_wizard_err_min_chars: {
    ru: 'Минимум {count} символов',
    en: 'Minimum {count} characters',
  },
  invite_wizard_err_mismatch: {
    ru: 'Пароли не совпадают',
    en: 'Passwords do not match',
  },
  invite_wizard_err_no_email: {
    ru: 'Не удалось узнать адрес из ссылки — откройте ссылку из письма ещё раз.',
    en: 'Could not resolve email from link — please reopen the link from your email.',
  },
  invite_wizard_err_offline: {
    ru: 'Нет соединения с сетью. Проверьте подключение и попробуйте снова.',
    en: 'No network connection. Please check your connection and try again.',
  },
  invite_wizard_err_session_lost: {
    ru: 'Вход по ссылке потерялся. Откройте ссылку из письма ещё раз; если она уже использована — попросите новое приглашение.',
    en: 'The sign-in from the link was lost. Open the link from the email again; if it has already been used, ask for a new invitation.',
  },
  invite_wizard_err_failed: {
    ru: 'Не удалось задать пароль. Ссылка могла устареть — попросите новое приглашение.',
    en: 'Failed to set password. The link may have expired — please request a new invitation.',
  },

  // Restore from cloud modal
  restore_cloud_title_completed: {
    ru: 'Восстановление завершено',
    en: 'Restore completed',
  },
  restore_cloud_title_failed: {
    ru: 'Восстановление не удалось',
    en: 'Restore failed',
  },
  restore_cloud_title_empty: {
    ru: 'Нечего восстанавливать',
    en: 'Nothing to restore',
  },
  restore_cloud_title_loading: {
    ru: 'Загрузка данных из облака',
    en: 'Downloading data from cloud',
  },
  // C-4 (R2-007): стадии прогресса восстановления — их видно в модалке.
  restore_cloud_stage_notes: {
    ru: 'Загрузка заметок и версий...',
    en: 'Loading notes and versions...',
  },
  restore_cloud_stage_notes_progress: {
    ru: 'Загрузка заметок ({current} из {total})...',
    en: 'Loading notes ({current} of {total})...',
  },
  restore_cloud_stage_derivatives: {
    ru: 'Загрузка сводок и производных данных ИИ...',
    en: 'Loading AI summaries and derived data...',
  },
  restore_cloud_stage_linking: {
    ru: 'Привязка разбора к заметкам...',
    en: 'Linking analysis to notes...',
  },
  restore_cloud_stage_done: {
    ru: 'Восстановление завершено',
    en: 'Restore complete',
  },
  restore_cloud_desc_loading_zero: {
    ru: 'На этом устройстве пока нет ваших записей, а в облаке сохранено … Хотите загрузить их сейчас?',
    en: 'There are no entries on this device yet, and the cloud has … Would you like to download them now?',
  },
  restore_cloud_desc_loading_nonzero: {
    ru: 'На этом устройстве … заметок, а в облаке найдено … Хотите синхронизировать недостающие данные?',
    en: 'There are … notes on this device, and … found in the cloud. Would you like to sync missing data?',
  },
  restore_cloud_desc_error_zero: {
    ru: 'На этом устройстве пока нет ваших записей. Хотите загрузить их из облака?',
    en: 'There are no entries on this device yet. Would you like to download them from the cloud?',
  },
  restore_cloud_desc_error_nonzero: {
    ru: 'На этом устройстве {localCount} заметок. Хотите синхронизировать недостающие данные?',
    en: 'There are {localCount} notes on this device. Would you like to sync missing data?',
  },
  restore_cloud_desc_ready_zero: {
    ru: 'На этом устройстве пока нет ваших записей, а в облаке сохранено {cloudCount}. Хотите загрузить их сейчас?',
    en: 'There are no entries on this device yet, and {cloudCount} stored in the cloud. Would you like to download them now?',
  },
  restore_cloud_desc_ready_nonzero: {
    ru: 'На этом устройстве {localCount} заметок, а в облаке найдено {cloudCount}. Хотите синхронизировать недостающие данные?',
    en: 'There are {localCount} notes on this device, and {cloudCount} found in the cloud. Would you like to sync missing data?',
  },
  restore_cloud_opt_notes_title: {
    ru: 'Заметки и история версий',
    en: 'Notes and version history',
  },
  restore_cloud_opt_notes_desc: {
    ru: 'Все тексты, сессии и правки ({count} заметок в облаке)',
    en: 'All texts, sessions, and edits ({count} notes in the cloud)',
  },
  restore_cloud_opt_ai_title: {
    ru: 'Разбор ИИ и поиск',
    en: 'AI analysis and search',
  },
  restore_cloud_opt_ai_desc: {
    ru: 'Сводки, ключевые темы, инсайты и векторы семантического поиска',
    en: 'Summaries, key themes, insights, and semantic search vectors',
  },
  restore_cloud_opt_profile_title: {
    ru: 'Личность, диалоги и история жизни',
    en: 'Personality, dialogues, and life story',
  },
  restore_cloud_opt_profile_desc: {
    ru: 'Портрет, грани профиля, история чатов, реестр тем и убеждения',
    en: 'Portrait, profile facets, chat history, theme ledger, and beliefs',
  },
  restore_cloud_btn_not_now: {
    ru: 'Не сейчас',
    en: 'Not now',
  },
  restore_cloud_btn_start: {
    ru: 'Начать загрузку',
    en: 'Start download',
  },
  restore_cloud_btn_retry: {
    ru: 'Повторить',
    en: 'Retry',
  },
  restore_cloud_prog_notes: {
    ru: 'Загружено заметок:',
    en: 'Notes downloaded:',
  },
  restore_cloud_prog_summaries: {
    ru: 'Восстановлено сводок:',
    en: 'Summaries restored:',
  },
  restore_cloud_prog_embeddings: {
    ru: 'Векторов поиска (эмбеддингов):',
    en: 'Search vectors (embeddings):',
  },
  restore_cloud_prog_ai_records: {
    ru: 'Записей ИИ и диалогов:',
    en: 'AI records and dialogues:',
  },
  restore_cloud_prog_keep_open: {
    ru: 'Пожалуйста, не закрывайте вкладку до завершения загрузки.',
    en: 'Please do not close this tab until the download completes.',
  },
  restore_cloud_fail_threw: {
    ru: 'Восстановление прервано ошибкой. Попробуйте ещё раз позже.',
    en: 'Restore interrupted by an error. Please try again later.',
  },
  restore_cloud_fail_empty: {
    ru: 'Проход завершился, но из облака ничего не вернулось.',
    en: 'The operation completed, but nothing was returned from the cloud.',
  },
  restore_cloud_stat_notes: {
    ru: 'Заметок восстановлено:',
    en: 'Notes restored:',
  },
  restore_cloud_stat_summaries: {
    ru: 'Сводок ИИ:',
    en: 'AI summaries:',
  },
  restore_cloud_stat_embeddings: {
    ru: 'Векторов поиска:',
    en: 'Search vectors:',
  },
  restore_cloud_stat_ai_records: {
    ru: 'Записей ИИ:',
    en: 'AI records:',
  },
  restore_cloud_stat_oversized: {
    ru: 'Превышают лимит размера (10 МБ):',
    en: 'Exceed size limit (10 MB):',
  },
  restore_cloud_success_title: {
    ru: 'Данные успешно загружены',
    en: 'Data downloaded successfully',
  },
  restore_cloud_success_embeddings: {
    ru: 'Векторов поиска (эмбеддингов):',
    en: 'Search vectors (embeddings):',
  },
  restore_cloud_success_ai_records: {
    ru: 'Записей ИИ (диалоги, портрет, темы):',
    en: 'AI records (dialogues, portrait, themes):',
  },
  restore_cloud_failed_skipped: {
    ru: 'Пропущено с ошибкой:',
    en: 'Skipped due to error:',
  },
  restore_cloud_oversized_skipped: {
    ru: 'Пропущено из-за превышения лимита 10 МБ:',
    en: 'Skipped due to exceeding 10 MB limit:',
  },
  restore_cloud_autosync_title: {
    ru: 'Включить автосинхронизацию на этом устройстве?',
    en: 'Enable auto-sync on this device?',
  },
  restore_cloud_autosync_desc: {
    ru: 'Новые заметки и правки будут автоматически сохраняться в облако.',
    en: 'New notes and edits will be automatically saved to the cloud.',
  },
  restore_cloud_autosync_enable: {
    ru: 'Включить автосинк',
    en: 'Enable auto-sync',
  },
  restore_cloud_autosync_manual: {
    ru: 'Оставить ручную',
    en: 'Keep manual',
  },
};
