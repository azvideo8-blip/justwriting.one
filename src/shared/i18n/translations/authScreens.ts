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
    ru: 'Голосовой ввод (диктовка) использует встроенное распознавание речи браузера: аудиозапись передаётся серверам вендора браузера (Google или Apple) для перевода в текст.',
    en: 'Voice input (dictation) uses browser-native speech recognition: audio recordings are transmitted to browser vendor servers (Google or Apple) for speech-to-text transcription.',
  },
  privacy_consent_third_party_p4: {
    ru: 'Если в заметке упомянуты другие люди, их слова и обстоятельства уходят вместе с текстом. Отдельной картотеки упомянутых людей приложение не ведёт.',
    en: 'If other people are mentioned in a note, their words and circumstances are sent along with the text. The app does not maintain a separate index of mentioned individuals.',
  },
  privacy_consent_links_prefix: {
    ru: 'Подробнее: ',
    en: 'Learn more: ',
  },
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
};
