import React, { createContext, useContext, useState, useCallback } from 'react';

type Language = 'ru' | 'en';

interface Translations {
  [key: string]: {
    ru: string;
    en: string;
  };
}

export const translations: Translations = {
  // Navigation
  nav_write: { ru: 'Писать', en: 'Write' },
  nav_notes: { ru: 'Мои заметки', en: 'My Notes' },
  nav_profile: { ru: 'Мой профиль', en: 'My Profile' },
  nav_stream_mode: { ru: 'Режим потока сознания', en: 'Stream Mode' },
  nav_admin: { ru: 'Админ', en: 'Admin' },
  nav_about: { ru: 'О приложении', en: 'About' },

  about_subtitle:       { ru: 'Место для текста', en: 'A place for writing' },
  about_description:    { ru: 'justwriting — минималистичный редактор для фрирайтинга и потокового письма. Всё сохраняется локально, облако — опционально.', en: 'justwriting is a minimalist editor for freewriting and stream-of-consciousness writing. Everything saves locally, cloud is optional.' },
  about_made_with_love: { ru: 'Сделано с любовью к процессу письма', en: 'Made with love for the writing process' },

  nav_logout: { ru: 'Выйти', en: 'Logout' },

  // Writing View & Setup
  writing_select_mode: { ru: 'Выберите режим', en: 'Select Mode' },
  writing_how_to_write: { ru: 'Как вы хотите писать сегодня?', en: 'How do you want to write today?' },
  writing_mode_flow: { ru: 'Свободный поток', en: 'Free Flow' },
  writing_mode_flow_desc: { ru: 'Просто секундомер. Пишите сколько угодно.', en: 'Just a stopwatch. Write as much as you want.' },
  writing_mode_timer: { ru: 'По таймеру', en: 'Timer' },
  writing_mode_timer_desc: { ru: 'Установите время. Фокусируйтесь до звонка.', en: 'Set a time. Focus until the bell.' },
  writing_mode_words: { ru: 'Цель по словам', en: 'Word Goal' },
  writing_mode_words_desc: { ru: 'Пишите, пока не достигнете лимита слов.', en: 'Write until you reach the word limit.' },
  writing_mode_deadline: { ru: 'Закончить до...', en: 'Finish by...' },
  writing_mode_deadline_desc: { ru: 'Установите дедлайн.', en: 'Set a deadline.' },
  writing_local_session: { ru: 'Локальная сессия', en: 'Local Session' },
  writing_local_desc: { ru: 'Сессия не будет добавлена в "Мои заметки". Не забудьте сохранить после завершения.', en: 'Session won\'t be added to "My Notes". Don\'t forget to save after finishing.' },
  writing_cancel: { ru: 'Отмена', en: 'Cancel' },
  writing_start: { ru: 'Начать', en: 'Start' },
  writing_back: { ru: 'Назад', en: 'Back' },
  writing_set_timer: { ru: 'Установить таймер', en: 'Set Timer' },
  writing_minutes: { ru: 'минут', en: 'minutes' },
  writing_words: { ru: 'слов', en: 'words' },
  writing_chars: { ru: 'символов', en: 'characters' },
  writing_time: { ru: 'время', en: 'time' },
  writing_continue_session: { ru: 'Выберите сессию для продолжения', en: 'Choose a session to continue' },
  writing_no_sessions: { ru: 'У вас пока нет сохраненных сессий', en: 'You don\'t have any saved sessions yet' },
  writing_cancel_confirm: { ru: 'Отменить сессию?', en: 'Cancel session?' },
  writing_cancel_desc: { ru: 'Весь несохраненный прогресс будет безвозвратно удален.', en: 'All unsaved progress will be permanently deleted.' },

  // Editor
  editor_title_placeholder: { ru: 'Заголовок...', en: 'Title...' },
  editor_content_placeholder: { ru: 'Начните писать...', en: 'Start writing...' },
  editor_idle_placeholder: { ru: 'Выберите режим и нажмите "Начать", чтобы приступить к письму', en: 'Select a mode and click "Start" to begin writing' },
  editor_writing_placeholder: { ru: 'Начните писать здесь...', en: 'Start writing here...' },
  writing_placeholder: { ru: 'Просто начни писать...', en: 'Just start writing...' },
  editor_pinned_thoughts: { ru: 'Закрепленные мысли', en: 'Pinned Thoughts' },
  editor_pinned_placeholder: { ru: 'Ваша закрепленная мысль...', en: 'Your pinned thought...' },
  editor_add_thought: { ru: 'Добавить мысль...', en: 'Add a thought...' },
  editor_pin_thought: { ru: 'Закрепить мысль', en: 'Pin thought' },
  editor_saving: { ru: 'Сохранение...', en: 'Saving...' },
  editor_saved: { ru: 'Сохранено', en: 'Saved' },
  editor_save_error: { ru: 'Ошибка сохранения', en: 'Save error' },
  editor_highlight: { ru: 'Выделить', en: 'Highlight' },

  // Header
  header_currentTime:  { ru: 'Текущее время',    en: 'Current time' },
  header_sessionTime:  { ru: 'Время сессии',     en: 'Session time' },
  header_remaining_time: { ru: 'Оставшееся время', en: 'Remaining Time' },
  header_overtime: { ru: 'Сверх нормы', en: 'Overtime' },
  header_sessionWords: { ru: 'Слов в сессии',    en: 'Session words' },
  header_totalWords:   { ru: 'Всего слов',        en: 'Total words' },
  header_wpm:          { ru: 'сл/мин',             en: 'wpm' },
  header_sessionWords_hint: { ru: 'слов в сессии · цель', en: 'session words · set goal' },
  header_time_hint:         { ru: 'время · цель',          en: 'time · set goal' },
  goal_time_remaining:      { ru: 'осталось',              en: 'remaining' },
  goal_time_done:           { ru: 'истекло',               en: 'done' },
  goal_time_of:             { ru: 'из',                    en: 'of' },
  goal_time_min:            { ru: 'мин',                   en: 'min' },
  header_new_session: { ru: 'Новая сессия', en: 'New Session' },
  header_continue: { ru: 'Продолжить', en: 'Continue' },
  header_draft: { ru: 'Черновик', en: 'Draft' },
  header_pause: { ru: 'Пауза', en: 'Pause' },
  header_continue_btn: { ru: 'Продолжить', en: 'Continue' },
  header_finish: { ru: 'Завершить', en: 'Finish' },
  header_cancel_session: { ru: 'Отменить сессию', en: 'Cancel Session' },
  header_fullscreen:      { ru: 'Полный экран', en: 'Fullscreen' },
  header_exit_fullscreen: { ru: 'Выйти из полного экрана', en: 'Exit fullscreen' },
  header_in_flow: { ru: 'В потоке', en: 'In Flow' },
  header_settings: { ru: 'Настройки', en: 'Settings' },
  nav_settings: { ru: 'Настройки', en: 'Settings' },
  settings_elements:   { ru: 'Видимость элементов', en: 'Element visibility' },
  layout_desktop:      { ru: 'Широкий',   en: 'Desktop' },
  layout_mobile:       { ru: 'Мобильный', en: 'Mobile' },

  // Session Card
  session_anonymous: { ru: 'Аноним', en: 'Anonymous' },
  session_untitled: { ru: 'Без названия', en: 'Untitled' },
  session_export: { ru: 'Экспорт', en: 'Export' },
  session_edit: { ru: 'Редактировать', en: 'Edit' },
  session_delete: { ru: 'Удалить', en: 'Delete' },
  session_delete_confirm: { ru: 'Подтвердить удаление', en: 'Confirm deletion' },
  session_collapse: { ru: 'Свернуть', en: 'Collapse' },
  session_expand: { ru: 'Развернуть', en: 'Expand' },
  session_add_tags: { ru: 'Добавить теги', en: 'Add tags' },
  session_tag_placeholder: { ru: 'тег...', en: 'tag...' },
  session_continue: { ru: 'Продолжить писать', en: 'Continue writing' },

  // Export
  export_txt: { ru: 'Текстовый (.txt)', en: 'Text (.txt)' },
  export_pdf: { ru: 'PDF (.pdf)', en: 'PDF (.pdf)' },
  export_md: { ru: 'Markdown (.md)', en: 'Markdown (.md)' },
  export_docx: { ru: 'Word (.docx)', en: 'Word (.docx)' },

  // Finish Modal
  finish_congrats: { ru: 'Отличная работа!', en: 'Great job!' },
  finish_stats: { ru: 'Статистика сессии', en: 'Session Stats' },
  finish_save: { ru: 'Сохранить', en: 'Save' },
  finish_discard: { ru: 'Удалить', en: 'Discard' },
  finish_tags: { ru: 'Теги', en: 'Tags' },
  finish_labels: { ru: 'Бирки', en: 'Labels' },
  finish_add_tag: { ru: 'Добавить тег...', en: 'Add tag...' },

  // Archive / My Notes
  notes_title: { ru: 'Мои заметки', en: 'My Notes' },
  notes_search: { ru: 'Поиск по заметкам...', en: 'Search notes...' },
  notes_empty: { ru: 'Здесь пока пусто. Начните писать!', en: 'It\'s empty here. Start writing!' },
  archive_title: { ru: 'Мои заметки', en: 'My Notes' },
  archive_search_placeholder: { ru: 'Поиск по заметкам...', en: 'Search notes...' },
  archive_empty: { ru: 'Здесь пока пусто. Начните писать!', en: 'It\'s empty here. Start writing!' },
  archive_loading: { ru: 'Загрузка заметок...', en: 'Loading notes...' },
  archive_load_error: { ru: 'Ошибка при загрузке заметок', en: 'Error loading notes' },
  archive_cloud_load_error: { ru: 'Не удалось загрузить облачные документы. Показаны только локальные.', en: 'Failed to load cloud documents. Showing local only.' },
  retry: { ru: 'Повторить', en: 'Retry' },
  guest_storage_full: { ru: 'Хранилище заполнено. Экспортируйте данные.', en: 'Storage full. Export your data.' },
  archive_list: { ru: 'Список', en: 'List' },
  archive_grid: { ru: 'Сетка', en: 'Grid' },
  archive_load_more: { ru: 'Загрузить еще', en: 'Load More' },
  archive_loading_more: { ru: 'Загрузка...', en: 'Loading...' },

  // Profile
  profile_title: { ru: 'Мой профиль', en: 'My Profile' },
  profile_settings_title: { ru: 'Настройки профиля', en: 'Profile settings' },
  profile_reset_achievements: { ru: 'Сбросить все достижения', en: 'Reset all achievements' },
  profile_reset_achievements_confirm: {
    ru: 'Вы уверены? Все достижения будут сброшены.',
    en: 'Are you sure? All achievements will be reset.'
  },
  reset_achievements_confirm: {
    ru: 'Все достижения будут удалены навсегда. Вы уверены?',
    en: 'All achievements will be permanently deleted. Are you sure?'
  },
  profile_stats: { ru: 'Статистика', en: 'Statistics' },
  profile_loading: { ru: 'Загружаем профиль...', en: 'Loading profile...' },
  profile_achievements: { ru: 'Достижения', en: 'Achievements' },
  profile_nickname: { ru: 'Никнейм', en: 'Nickname' },
  profile_theme_title: { ru: 'Дизайн', en: 'Design' },
  profile_word_cloud: { ru: 'Облако слов', en: 'Word Cloud' },
  profile_no_words: { ru: 'Слов пока нет', en: 'No words yet' },
  profile_streak: { ru: 'дн. стрик', en: 'day streak' },
  profile_words: { ru: 'слов', en: 'words' },
  admin_title: { ru: 'Панель управления', en: 'Control Panel' },
  admin_tab_users: { ru: 'Пользователи', en: 'Users' },
  admin_tab_sessions: { ru: 'Сессии', en: 'Sessions' },
  admin_tab_security: { ru: 'Безопасность', en: 'Security' },
  admin_confirm_delete_session: { ru: 'Вы уверены, что хотите удалить эту сессию?', en: 'Are you sure you want to delete this session?' },
  admin_security_active: { ru: 'Активная защита', en: 'Active Protection' },
  admin_security_validation: { ru: 'Валидация схем данных на уровне Firestore', en: 'Firestore-level data schema validation' },
  admin_security_size_limits: { ru: 'Ограничение размера строковых полей (защита от DoS)', en: 'String field size limits (DoS protection)' },
  admin_security_typing: { ru: 'Строгая типизация всех входящих данных', en: 'Strict typing for all incoming data' },
  admin_security_uid_protection: { ru: 'Защита от подмены UID автора', en: 'Protection against author UID spoofing' },
  admin_security_email_validation: { ru: 'Email-валидация через регулярные выражения', en: 'Email validation via regex' },
  admin_security_xss: { ru: 'React автоматически экранирует все данные, предотвращая внедрение скриптов.', en: 'React automatically escapes all data, preventing script injection.' },
  admin_security_csrf: { ru: 'Firebase Auth использует защищенные токены и SameSite куки.', en: 'Firebase Auth uses secure tokens and SameSite cookies.' },
  // Achievements
  ach_streak_1: { ru: 'Первые шаги', en: 'First Steps' },
  ach_streak_3: { ru: 'Начинающий писатель', en: 'Aspiring Writer' },
  ach_streak_7: { ru: 'Еженедельный вдохновитель', en: 'Weekly Inspirer' },
  ach_streak_10: { ru: 'Десять дней упорства', en: 'Ten-Day Persistent' },
  ach_streak_14: { ru: 'Две недели успеха', en: 'Two-Week Champion' },
  ach_streak_21: { ru: 'Три недели фанатизма', en: 'Three-Week Fanatic' },
  ach_streak_30: { ru: 'Месячная легенда', en: 'Monthly Legend' },
  ach_streak_60: { ru: 'Два месяца железа', en: 'Two-Month Iron' },
  ach_streak_90: { ru: 'Квартальный король', en: 'Quarterly Key King' },
  ach_streak_180: { ru: 'Полугодовой гигант пера', en: 'Half-Year Pen Giant' },
  ach_streak_365: { ru: 'Годовой бессмертный', en: 'Yearly Immortal' },

  ach_words_500: { ru: 'Первые 500 слов', en: 'Five-Hundred Word Starter' },
  ach_words_1000: { ru: 'Герой тысячи слов', en: 'Kilo-Word Hero' },
  ach_words_2500: { ru: 'Воин 2500 слов', en: 'Two-and-a-Half Thousand Word Warrior' },
  ach_words_5000: { ru: 'Сказочник 5000 слов', en: 'Five-Thousand Storyteller' },
  ach_words_10000: { ru: 'Десятитысячник', en: 'Ten-Thousander' },
  ach_words_25000: { ru: 'Романтик 25000 слов', en: 'Twenty-Five Thousand Romantic' },
  ach_words_50000: { ru: 'Эпик полувека', en: 'Half-Century Epic' },
  ach_words_100000: { ru: 'Мастер 100 000 слов', en: 'Master of One Hundred Thousand' },
  ach_words_250000: { ru: 'Визионер четверти миллиона', en: 'Quarter-Million Visionary' },
  ach_words_500000: { ru: 'Бог полумиллиона слов', en: 'Half-Million Word God' },

  ach_notes_5: { ru: 'Пять идей', en: 'Five Ideas' },
  ach_notes_10: { ru: 'Десять мыслей', en: 'Ten Thoughts' },
  ach_notes_25: { ru: 'Двадцать пять сокровищ', en: 'Twenty-Five Treasures' },
  ach_notes_50: { ru: 'Пятьдесят заметок', en: 'Fifty Notes' },
  ach_notes_100: { ru: 'Сто историй', en: 'Hundred Stories' },
  ach_notes_250: { ru: 'Четверть тысячи идей', en: 'Quarter-Thousand Ideas' },

  ach_duration_30: { ru: 'Полчаса славы', en: 'Half-Hour of Fame' },
  ach_duration_60: { ru: 'Часовой воин', en: 'Hourly Warrior' },
  ach_duration_180: { ru: 'Трехчасовой титан', en: 'Three-Hour Titan' },

  ach_section_streaks: { ru: 'Стрики (дней подряд)', en: 'Streaks (days in a row)' },
  ach_section_words: { ru: 'Всего слов', en: 'Total words' },
  ach_section_notes: { ru: 'Всего заметок', en: 'Total notes' },
  ach_section_duration: { ru: 'Длительность сессии (макс)', en: 'Session duration (max)' },
  ach_earned: { ru: 'Получено', en: 'Earned' },

  // Settings
  settings_title: { ru: 'Настройки', en: 'Settings' },
  settings_font: { ru: 'Шрифт', en: 'Font' },
  settings_editor_width: { ru: 'Ширина редактора', en: 'Editor width' },
  settings_width: { ru: 'Ширина текста', en: 'Text Width' },
  settings_width_centered: { ru: 'По центру', en: 'Centered' },
  settings_width_full: { ru: 'На весь экран', en: 'Full screen' },
  settings_font_size: { ru: 'Размер шрифта', en: 'Font Size' },
  settings_zen: { ru: 'Дзен-режим', en: 'Zen Mode' },
  settings_zen_mode: { ru: 'Дзен-режим', en: 'Zen Mode' },
  settings_zen_desc: { ru: 'Скрывает интерфейс во время письма', en: 'Hides interface while writing' },
  settings_dynamic_bg: { ru: 'Динамический фон', en: 'Dynamic Background' },
  settings_dynamic_bg_desc: { ru: 'Цвет меняется в зависимости от скорости письма', en: 'Color changes based on typing speed' },
  settings_stream_mode: { ru: 'Режим потока сознания', en: 'Stream of Consciousness Mode' },
  settings_stream_mode_desc: { ru: 'нет возможности удалять, вставлять текст. Только чистый поток сознания', en: 'No ability to delete or paste text. Only pure stream of consciousness.' },
  settings_momentum: { ru: 'Режим "Как есть"', en: 'Momentum Mode' },
  settings_momentum_desc: { ru: 'Отключает функции Backspace и Delete, чтобы писать без исправлений, как есть', en: 'Disables Backspace and Delete to keep you moving forward.' },
  layout_switch_desktop: { ru: 'Широкий экран', en: 'Desktop view' },
  layout_switch_mobile:  { ru: 'Мобильный вид', en: 'Mobile view' },
  settings_tab_editor:   { ru: 'Редактор',    en: 'Editor' },
  settings_tab_app:      { ru: 'Приложение',  en: 'Application' },
  settings_tab_account:  { ru: 'Аккаунт',     en: 'Account' },
  settings_language:     { ru: 'Язык',         en: 'Language' },
  settings_layout:       { ru: 'Раскладка',    en: 'Layout' },
  settings_interface:    { ru: 'Интерфейс',    en: 'Interface' },
  settings_features:     { ru: 'Возможности',  en: 'Features' },
  settings_done: { ru: 'Готово', en: 'Done' },
  settings_writing_modes: { ru: 'Режимы письма',       en: 'Writing modes' },
  settings_header:        { ru: 'Заголовок',            en: 'Header' },
  settings_show_title:  { ru: 'Заголовок',          en: 'Title' },
  settings_show_pinned: { ru: 'Закреп. мысли',       en: 'Pinned thoughts' },
  settings_show_in_panel: { ru: 'Показывать в панели',  en: 'Show in panel' },

  // Units
  unit_min: { ru: 'м', en: 'm' },
  unit_hour: { ru: 'ч', en: 'h' },
  unit_words: { ru: 'сл', en: 'w' },

  // Common
  common_loading: { ru: 'Загрузка...', en: 'Loading...' },
  common_error: { ru: 'Ошибка', en: 'Error' },
  common_offline: { ru: 'НЕТ СВЯЗИ С БАЗОЙ ДАННЫХ. ПРОВЕРЬТЕ ИНТЕРНЕТ.', en: 'NO CONNECTION TO DATABASE. CHECK YOUR INTERNET.' },
  common_untitled: { ru: 'Без названия', en: 'Untitled' },
  common_cancel: { ru: 'Отмена', en: 'Cancel' },
  common_save: { ru: 'Сохранить', en: 'Save' },
  common_close: { ru: 'Закрыть', en: 'Close' },
  
  // Auth
  auth_error_google_network: { ru: 'Ошибка сети при авторизации через Google. Проверьте интернет-соединение или настройки Authorized Domains в консоли Firebase.', en: 'Network error during Google sign-in. Check your internet connection or Authorized Domains settings in Firebase Console.' },
  auth_error_generic: { ru: 'Произошла ошибка при входе.', en: 'An error occurred during sign-in.' },
  auth_error_fields_required: { ru: 'Пожалуйста, заполните все поля.', en: 'Please fill in all fields.' },
  auth_error_user_not_found: { ru: 'Пользователь не найден.', en: 'User not found.' },
  auth_error_wrong_password: { ru: 'Неверный пароль.', en: 'Incorrect password.' },
  auth_error_email_in_use: { ru: 'Этот email уже используется.', en: 'This email is already in use.' },
  auth_error_weak_password: { ru: 'Пароль слишком простой.', en: 'Password is too weak.' },
  auth_error_invalid_credential: { ru: 'Неверный email или пароль.', en: 'Invalid email or password.' },
  auth_error_operation_not_allowed: { ru: 'Вход по Email не включен в консоли Firebase. Пожалуйста, включите провайдера \'Email/Password\' в настройках Authentication.', en: 'Email sign-in is not enabled in Firebase Console. Please enable the \'Email/Password\' provider in Authentication settings.' },
  auth_error_network: { ru: 'Ошибка сети при попытке входа. Проверьте соединение или убедитесь, что провайдер Email включен в консоли Firebase.', en: 'Network error during sign-in. Check your connection or ensure the Email provider is enabled in Firebase Console.' },
  auth_error_internal: { ru: 'Внутренняя ошибка Firebase. Убедитесь, что провайдер Email/Password включен в консоли Firebase (Authentication -> Sign-in method), или попробуйте позже.', en: 'Internal Firebase error. Ensure the Email/Password provider is enabled in Firebase Console (Authentication -> Sign-in method), or try again later.' },
  auth_subtitle: { ru: 'Минималистичное пространство для писателей.', en: 'A minimalist space for writers.' },
  auth_password: { ru: 'Пароль', en: 'Password' },
  auth_sign_in: { ru: 'Войти', en: 'Sign In' },
  auth_sign_up: { ru: 'Создать аккаунт', en: 'Create Account' },
  auth_or: { ru: 'Или', en: 'Or' },
  auth_no_account: { ru: 'Нет аккаунта? Зарегистрироваться', en: "Don't have an account? Sign Up" },
  auth_has_account: { ru: 'Уже есть аккаунт? Войти', en: 'Already have an account? Sign In' },
  auth_tagline: { ru: 'Никаких отвлекающих факторов. Только вы и ваши слова.', en: 'No distractions. Just you and your words.' },
  auth_required_title: { ru: 'Требуется авторизация', en: 'Sign in required' },
  auth_required_hint: { ru: 'Войдите, чтобы получить доступ к этой функции.', en: 'Sign in to access this feature.' },

  // Guest
  guest_welcome_subtitle: { ru: 'Минималистичное пространство для писателей. Начните писать прямо сейчас — регистрация займёт минуту.', en: 'A minimalist space for writers. Start writing now — sign-up takes a minute.' },
  guest_start_writing: { ru: 'Начать писать', en: 'Start Writing' },
  guest_save_hint: { ru: 'Войдите, чтобы сохранять сессии и получать доступ ко всем функциям.', en: 'Sign in to save sessions and access all features.' },
  guest_save_prompt: { ru: 'Войдите, чтобы сохранить вашу работу в облако и продолжить в любой момент.', en: 'Sign in to save your work to the cloud and continue at any time.' },
  guest_saved_locally: { ru: 'Сохранено на устройстве', en: 'Saved on this device' },
  guest_local_documents: { ru: 'Локальные документы', en: 'Local documents' },
  guest_no_documents: { ru: 'Ещё нет документов', en: 'No documents yet' },
  guest_sync_hint: { ru: 'Войдите чтобы синхронизировать между устройствами', en: 'Sign in to sync across devices' },
  guest_save_title: { ru: 'Сохранить сессию', en: 'Save session' },
  guest_save_new_document: { ru: 'Новый документ', en: 'New document' },
  guest_save_existing_document: { ru: 'Добавить версию к документу', en: 'Add version to document' },
  guest_save_button: { ru: 'Сохранить', en: 'Save' },
  guest_save_local: { ru: 'Сохранить локально', en: 'Save locally' },
  guest_more_documents: { ru: 'Ещё {count} документов', en: '{count} more documents' },

  // Storage
  finish_storage_label: { ru: 'Сохранить в', en: 'Save to' },
  storage_cloud: { ru: 'Облако', en: 'Cloud' },
  storage_local: { ru: 'Устройство', en: 'Device' },
  storage_both: { ru: 'Локально и облако', en: 'Local & Cloud' },
  storage_local_hint: { ru: 'Доступно только на этом устройстве', en: 'Available on this device only' },
  storage_both_hint: { ru: 'Сохранится и локально и в облаке', en: 'Saved both locally and in cloud' },
  settings_section_storage: { ru: 'Хранилище', en: 'Storage' },
  settings_storage_default: { ru: 'По умолчанию', en: 'Default' },
  settings_auto_sync: { ru: 'Автосинхронизация с облаком', en: 'Auto-sync to cloud' },
  settings_auto_sync_hint: { ru: 'Заметки автоматически загружаются в облако после сохранения', en: 'Notes are automatically uploaded to cloud after saving' },
  settings_sync_now: { ru: 'Синхронизировать сейчас', en: 'Sync now' },
  settings_upload_to_cloud: { ru: 'Загрузить на облако', en: 'Upload to cloud' },
  settings_storage_hint: { ru: 'Все заметки хранятся на устройстве. Облако — резервная копия.', en: 'All notes are stored on device. Cloud is a backup.' },

  // Storage icons & delete
  storage_remove_local: { ru: 'Удалить локальную копию', en: 'Remove local copy' },
  storage_remove_cloud: { ru: 'Удалить облачную копию', en: 'Remove cloud copy' },
  storage_no_local: { ru: 'Нет локальной копии', en: 'No local copy' },
  storage_no_cloud: { ru: 'Нет облачной копии', en: 'No cloud copy' },
  storage_confirm_delete_local: { ru: 'Удалить локальную копию?', en: 'Remove local copy?' },
  storage_confirm_delete_cloud: { ru: 'Удалить облачную копию?', en: 'Remove cloud copy?' },
  storage_confirm_delete_only: { ru: 'Удалить документ полностью?', en: 'Delete document completely?' },
  storage_confirm_delete_local_hint: { ru: 'Останется только облачная версия', en: 'Only cloud version will remain' },
  storage_confirm_delete_cloud_hint: { ru: 'Останется только локальная версия', en: 'Only local version will remain' },
  storage_confirm_delete_only_hint: { ru: 'Документ будет удалён навсегда', en: 'Document will be permanently deleted' },
  storage_delete_confirm: { ru: 'Удалить', en: 'Delete' },
  storage_deleted_local: { ru: 'Локальная копия удалена', en: 'Local copy removed' },
  storage_deleted_cloud: { ru: 'Облачная копия удалена', en: 'Cloud copy removed' },
  storage_deleted_completely: { ru: 'Документ удалён', en: 'Document deleted' },

  // Finish modal storage hint
  finish_saving_to_local: { ru: 'Сохраняется на устройство', en: 'Saving to device' },
  finish_saving_to_cloud: { ru: 'Сохраняется в облако', en: 'Saving to cloud' },
  finish_saving_to_both: { ru: 'Сохраняется локально и в облако', en: 'Saving locally and to cloud' },
  finish_change_in_settings: { ru: 'изменить', en: 'change' },

  // Storage guest hints
  storage_cloud_guest_hint: { ru: 'Войдите, чтобы сохранять в облако', en: 'Sign in to save to cloud' },
  storage_sign_in_for_cloud: { ru: 'Войти для облака', en: 'Sign in for cloud' },

  // Offline
  offline_working_locally: { ru: 'Нет соединения — работаем локально', en: 'Offline — working locally' },
  offline_syncing: { ru: 'Синхронизируется...', en: 'Syncing...' },
  offline_pending: { ru: 'Ожидает синхронизации: {count}', en: '{count} pending sync' },
  offline_synced: { ru: 'Все данные синхронизированы', en: 'All data synced' },

  // Finish Modal
  finish_back: { ru: 'Вернуться', en: 'Go Back' },

  // Offline
  offline_banner_message: { ru: 'Работа в офлайн-режиме. Сессия будет сохранена локально.', en: 'Working offline. Session will be saved locally.' },

  // Charts
  chart_time: { ru: 'Время:', en: 'Time:' },
  chart_words: { ru: 'Слова:', en: 'Words:' },

  // Tags
  tag_cloud_title: { ru: 'Облако тегов', en: 'Tag Cloud' },
  tag_cloud_empty: { ru: 'Тегов пока нет', en: 'No tags yet' },

  // Errors
  error_permission_denied: { ru: 'У вас нет прав для выполнения этого действия.', en: "You don't have permission to perform this action." },
  error_unavailable: { ru: 'Сервис временно недоступен. Попробуйте позже.', en: 'Service temporarily unavailable. Please try again later.' },
  error_invalid_credentials: { ru: 'Неверный email или пароль.', en: 'Invalid email or password.' },
  error_too_many_requests: { ru: 'Слишком много попыток. Попробуйте позже.', en: 'Too many attempts. Please try again later.' },

  // Admin
  admin_col_title: { ru: 'Заголовок', en: 'Title' },
  admin_col_author: { ru: 'Автор', en: 'Author' },
  admin_col_date: { ru: 'Дата', en: 'Date' },
  admin_col_actions: { ru: 'Действия', en: 'Actions' },
  admin_col_role: { ru: 'Роль', en: 'Role' },
  common_anonymous: { ru: 'Аноним', en: 'Anonymous' },

  // Profile
  profile_activity: { ru: 'Активность', en: 'Activity' },
  profile_labels: { ru: 'Бирки', en: 'Labels' },
  profile_label_name: { ru: 'Название бирки', en: 'Label Name' },
  profile_back: { ru: 'Назад к профилю', en: 'Back to Profile' },
  profile_notes_with_word: { ru: 'Заметки со словом', en: 'Notes with Word' },

  // Archive
  archive_labels: { ru: 'Бирки', en: 'Labels' },
  archive_label_name: { ru: 'Название бирки', en: 'Label Name' },

  // Data Transfer
  data_export_success:  { ru: 'Все сессии экспортированы',  en: 'All sessions exported' },
  data_export_error:    { ru: 'Ошибка при экспорте',         en: 'Export failed' },
  data_import_success:  { ru: 'Сессии импортированы',        en: 'Sessions imported' },
  data_import_error:    { ru: 'Ошибка при импорте',          en: 'Import failed' },
  data_import_invalid:  { ru: 'Неверный формат данных',      en: 'Invalid data format' },
  settings_data_section: { ru: 'Данные',                     en: 'Data' },

  // Plurals
  words_count_one:  { ru: '{count} слово',  en: '{count} word' },
  words_count_few:  { ru: '{count} слова',  en: '{count} words' },
  words_count_many: { ru: '{count} слов',   en: '{count} words' },

  minutes_one:  { ru: '{count} минута',  en: '{count} minute' },
  minutes_few:  { ru: '{count} минуты',  en: '{count} minutes' },
  minutes_many: { ru: '{count} минут',   en: '{count} minutes' },

  sessions_one:  { ru: '{count} сессия',  en: '{count} session' },
  sessions_few:  { ru: '{count} сессии',  en: '{count} sessions' },
  sessions_many: { ru: '{count} сессий',  en: '{count} sessions' },

  profile_sessions_found: { ru: 'Найдено {count} сессий', en: '{count} sessions found' },
  topbar_new:  { ru: 'Новая заметка', en: 'New note' },
  topbar_open: { ru: 'Открыть',       en: 'Open' },
  topbar_save: { ru: 'Сохранить',     en: 'Save' },
  topbar_title_placeholder: { ru: 'Название сессии', en: 'Session title' },
  stats_words: { ru: 'Слова', en: 'Words' },
  stats_time: { ru: 'Время', en: 'Time' },

  play:            { ru: 'Начать',      en: 'Play' },
  pause:           { ru: 'Пауза',       en: 'Pause' },
  stop:            { ru: 'Стоп',        en: 'Stop' },

  lifelog_tab_log:       { ru: 'Life Log',     en: 'Life Log' },
  lifelog_tab_settings:  { ru: 'Настройки',    en: 'Settings' },
  lifelog_pin:           { ru: 'Закрепить',     en: 'Pin' },
  lifelog_unpin:         { ru: 'Открепить',     en: 'Unpin' },
  lifelog_today:         { ru: 'Сегодня',       en: 'Today' },
  lifelog_status_unsaved: { ru: 'не сохранено', en: 'unsaved' },
  lifelog_status_published: { ru: 'опубликовано', en: 'published' },
  lifelog_status_saved:   { ru: 'сохранено',     en: 'saved' },
  lifelog_words:         { ru: 'слов',          en: 'words' },
  lifelog_time:          { ru: 'в потоке',      en: 'in flow' },
  lifelog_loading:       { ru: 'Загрузка...',   en: 'Loading...' },
  lifelog_settings_soon: { ru: 'Скоро здесь появятся настройки', en: 'Settings coming soon' },
  lifelog_words_short:  { ru: 'сл',      en: 'w' },
  lifelog_group_now:    { ru: 'Сейчас',  en: 'Now' },
  lifelog_group_today:  { ru: 'Сегодня', en: 'Today' },
  lifelog_group_yesterday: { ru: 'Вчера', en: 'Yesterday' },
  lifelog_group_earlier: { ru: 'Раньше', en: 'Earlier' },
  lifelog_empty:        { ru: 'Нет сессий', en: 'No sessions yet' },
  lifelog_search_placeholder: { ru: 'Поиск по заметкам...', en: 'Search notes...' },

  stats_set_word_goal: { ru: 'Цель по словам',  en: 'Set word goal' },
  stats_set_time_goal: { ru: 'Цель по времени', en: 'Set time goal' },
  stats_writing:       { ru: 'пишу',            en: 'writing' },

  goal_popup_words_title: { ru: 'Цель по словам',  en: 'Word goal' },
  goal_popup_time_title:  { ru: 'Цель по времени', en: 'Time goal' },
  goal_popup_clear:       { ru: 'Убрать',          en: 'Clear' },
  goal_words_short:       { ru: 'слов',           en: 'words' },
  goal_time_short:        { ru: 'мин',           en: 'mins' },
  common_ok:              { ru: 'Ок',              en: 'OK' },

  save_success: { ru: 'Заметка сохранена', en: 'Note saved' },
  session_deleted: { ru: 'Заметка удалена', en: 'Note deleted' },
  save_error:   { ru: 'Ошибка при сохранении', en: 'Save failed' },
  save_status_saving: { ru: 'сохраняю…', en: 'saving…' },

  error_generic_action: { ru: 'Что-то пошло не так. Попробуйте ещё раз.', en: 'Something went wrong. Please try again.' },
  error_save_failed:    { ru: 'Не удалось сохранить. Попробуйте ещё раз.', en: 'Failed to save. Please try again.' },
  error_delete_failed:  { ru: 'Не удалось удалить.',                       en: 'Failed to delete.' },
  error_load_failed:    { ru: 'Не удалось загрузить данные.',               en: 'Failed to load data.' },
  error_nickname_failed:{ ru: 'Не удалось обновить никнейм.',               en: 'Failed to update nickname.' },
  error_export_failed:  { ru: 'Не удалось экспортировать.',                 en: 'Failed to export.' },
  error_signout_failed: { ru: 'Не удалось выйти из аккаунта.',             en: 'Failed to sign out.' },
  error_labels_failed:  { ru: 'Не удалось обновить ярлыки.',               en: 'Failed to update labels.' },

  migration_found_title:        { ru: 'Локальные записи найдены',             en: 'Local records found' },
  migration_found_hint:         { ru: 'У вас {count} локальных записей. Переместить их в аккаунт?', en: 'You have {count} local records. Move them to your account?' },
  migration_move_to_account:    { ru: 'Переместить в аккаунт',               en: 'Move to account' },
  migration_keep_local:         { ru: 'Оставить локальными',                 en: 'Keep local' },
  migration_success_local:      { ru: 'Перемещено записей: {count}',         en: 'Records moved: {count}' },

  finish_modal_choose_title:      { ru: 'Сохранить сессию',           en: 'Save session' },
  finish_modal_new_doc:           { ru: 'Новый документ',              en: 'New document' },
  finish_modal_new_doc_hint:      { ru: 'Начать новый текст',          en: 'Start a new text' },
  finish_modal_continue_doc:      { ru: 'Продолжить документ',         en: 'Continue document' },
  finish_modal_continue_doc_hint: { ru: 'Добавить версию к существующему', en: 'Add version to existing' },
  finish_modal_select_doc:        { ru: 'Выберите документ',           en: 'Select document' },
  finish_modal_add_version:       { ru: 'Добавить версию',             en: 'Add version' },
  finish_modal_save_legacy_hint:  { ru: 'Сохранить как раньше',        en: 'Save as before' },

  lifelog_documents:      { ru: 'Документы',  en: 'Documents' },
  lifelog_sessions_count: { ru: 'сессий',     en: 'sessions' },
  save_status_saved:  { ru: 'сохранено', en: 'saved' },

  greeting_morning:   { ru: 'Доброе утро',    en: 'Good morning' },
  greeting_day:       { ru: 'Добрый день',     en: 'Good afternoon' },
  greeting_evening:   { ru: 'Добрый вечер',    en: 'Good evening' },
  greeting_night:     { ru: 'Доброй ночи',     en: 'Good night' },
  greeting_question:  { ru: 'что на уме?',     en: "what's on your mind?" },
  home_streak_days:   { ru: 'дней',            en: 'days' },
  home_cta:           { ru: 'Начать',          en: 'Start' },
  home_cta_hint:      { ru: 'или просто начни писать',  en: 'or just start typing' },
  home_today_words:   { ru: 'слов сегодня',    en: 'words today' },
  home_today_flow:    { ru: 'в потоке',        en: 'in flow' },
  home_recent:        { ru: 'Недавние',        en: 'Recent' },
  home_words_short:   { ru: 'сл',             en: 'w' },
  focus_exit_hint:   { ru: 'свайп вверх — выйти', en: 'swipe up to exit' },
  log_week_summary:  { ru: 'За 7 дней',           en: 'Last 7 days' },
  log_no_results:    { ru: 'Ничего не найдено',    en: 'No results' },
  log_empty:         { ru: 'Пока нет записей',     en: 'No entries yet' },
  me_tab_stats:      { ru: 'Статистика',           en: 'Stats' },
  me_tab_writing:    { ru: 'Письмо',               en: 'Writing' },
  me_tab_account:    { ru: 'Аккаунт',              en: 'Account' },
  me_stat_total_words: { ru: 'слов всего',         en: 'total words' },
  me_stat_sessions:  { ru: 'сессий',               en: 'sessions' },
  me_stat_streak:    { ru: 'дней подряд',           en: 'day streak' },
  me_stat_total_time: { ru: 'в потоке',            en: 'in flow' },
  me_stat_avg_wpm:   { ru: 'сл/мин средн.',        en: 'avg wpm' },
  me_stat_avg_session: { ru: 'слов/сессия',        en: 'words/session' },
  me_anonymous:      { ru: 'Аноним',               en: 'Anonymous' },
  me_account_email:  { ru: 'Email',                en: 'Email' },
  me_sign_out:       { ru: 'Выйти',                en: 'Sign out' },
  settings_section_font: { ru: 'Шрифт', en: 'Font' },

  profile_load_error:          { ru: 'Ошибка загрузки профиля', en: 'Failed to load profile' },
  profile_member_since:       { ru: 'В практике с',              en: 'Writing since' },
  profile_avg_session:        { ru: 'средняя сессия',             en: 'avg session' },
  profile_typical_hour:       { ru: 'обычно начинает',            en: 'usually starts' },
  profile_words_per_day:      { ru: 'слов в день',                en: 'words/day' },
  profile_streak_title:       { ru: 'Серия дней',                 en: 'Streak' },
  profile_streak_current_month: { ru: 'последние 30 дней',        en: 'last 30 days' },
  profile_streak_now:         { ru: 'сейчас',                     en: 'now' },
  profile_streak_best:        { ru: 'лучшая',                     en: 'best' },
  profile_streak_today:       { ru: 'сегодня',                    en: 'today' },
  profile_heatmap_title:      { ru: 'Активность',                  en: 'Activity' },
  profile_heatmap_hint:       { ru: 'оттенок — объём слов',       en: 'shade = word count' },
  profile_heatmap_less:       { ru: 'меньше',                     en: 'less' },
  profile_heatmap_more:       { ru: 'больше',                     en: 'more' },
  profile_rhythm_title:       { ru: 'Ритм дня',                   en: 'Daily rhythm' },
  profile_rhythm_peak:        { ru: 'типичный час',               en: 'typical hour' },
  profile_achievements_title:  { ru: 'Достижения',  en: 'Achievements' },
  profile_achievement_done:    { ru: 'получено',     en: 'unlocked' },
  profile_achievement_locked:  { ru: 'не получено',  en: 'locked' },
  profile_ach_group_streak:  { ru: 'Стрики (дней подряд)',  en: 'Streaks (days in a row)' },
  profile_ach_group_words:   { ru: 'Всего слов',            en: 'Total words' },
  profile_ach_opened:        { ru: 'открыто',               en: 'unlocked' },
  profile_ach_legendary:     { ru: 'легендарных',           en: 'legendary' },
  profile_ach_streak_1:      { ru: 'Первые шаги',           en: 'First steps' },
  profile_ach_streak_3:      { ru: 'Начинающий писатель',   en: 'Beginner writer' },
  profile_ach_streak_7:      { ru: 'Еженедельный вдохновитель', en: 'Weekly spark' },
  profile_ach_streak_10:     { ru: 'Десять дней упорства',  en: 'Ten days strong' },
  profile_ach_streak_14:     { ru: 'Две недели успеха',     en: 'Two weeks in' },
  profile_ach_streak_21:     { ru: 'Три недели фанатизма',  en: 'Three week streak' },
  profile_ach_streak_30:     { ru: 'Месячная легенда',      en: 'Monthly legend' },
  profile_ach_streak_60:     { ru: 'Два месяца железа',     en: 'Iron two months' },
  profile_ach_streak_90:     { ru: 'Квартальный король',    en: 'Quarterly king' },
  profile_ach_streak_180:    { ru: 'Полугодовой гигант',    en: 'Half-year giant' },
  profile_ach_streak_365:    { ru: 'Годовой бессмертный',   en: 'Annual immortal' },
  profile_ach_words_500:     { ru: 'Первые 500 слов',       en: 'First 500 words' },
  profile_ach_words_1k:      { ru: 'Герой тысячи слов',     en: 'Thousand hero' },
  profile_ach_words_2500:    { ru: 'Воин 2500 слов',        en: '2500 warrior' },
  profile_ach_words_5k:      { ru: 'Сказочник 5000 слов',   en: '5000 storyteller' },
  profile_ach_words_10k:     { ru: 'Десятитысячник',        en: '10K achiever' },
  profile_ach_words_25k:     { ru: 'Романтик 25000 слов',   en: '25K romantic' },
  profile_ach_words_50k:     { ru: 'Эпик полувека',         en: '50K epic' },
  profile_ach_words_100k:    { ru: 'Мастер 100 000 слов',   en: '100K master' },
  profile_ach_words_250k:    { ru: 'Визионер четверти миллиона', en: '250K visionary' },
  profile_ach_words_500k:    { ru: 'Бог полумиллиона слов', en: '500K legend' },
  profile_ach_reset:         { ru: 'Сбросить все достижения', en: 'Reset all achievements' },
  profile_ach_reset_confirm: { ru: 'Сбросить все достижения? Это действие нельзя отменить.', en: 'Reset all achievements? This cannot be undone.' },
  archive_wordcloud_title:     { ru: 'Облако слов',  en: 'Word cloud' },
  session_delete_confirm_desc: { ru: 'Это действие нельзя отменить', en: 'This action cannot be undone' },

  // Settings
  settings_font_preview: { ru: 'Aa 123', en: 'Aa 123' },

  nav_main: { ru: 'Основная навигация', en: 'Main navigation' },
  skip_to_content: { ru: 'Перейти к содержимому', en: 'Skip to content' },
  goal_reached_time:  { ru: 'Время вышло — цель достигнута', en: 'Time is up — goal reached' },
  goal_reached_words: { ru: 'Цель по словам достигнута',     en: 'Word goal reached' },
  
  // Extra
  writing_timer: { ru: 'Таймер', en: 'Timer' },
  writing_total: { ru: 'Всего', en: 'Total' },
  writing_wpm: { ru: 'Слов/мин', en: 'WPM' },
  onboarding_title:    { ru: 'Просто начните писать', en: 'Just start writing' },
  onboarding_subtitle: { ru: 'Выберите режим и нажмите +. Остальное не важно.', en: 'Pick a mode and press +. Nothing else matters.' },
  onboarding_cta:      { ru: 'Начать первую сессию', en: 'Start first session' },
  nav_write_short:     { ru: 'Писать',    en: 'Write' },
  nav_notes_short:     { ru: 'Заметки',   en: 'Notes' },
  nav_profile_short:   { ru: 'Профиль',   en: 'Profile' },
  nav_me: { ru: 'Я', en: 'Me' },
  achievements_unlocked:  { ru: 'открыто', en: 'unlocked' },
  achievements_legendary: { ru: 'легендарных', en: 'legendary' },
  archive_empty_title:    { ru: 'Пока нет записей',          en: 'No entries yet' },
  archive_empty_subtitle: { ru: 'Завершите первую сессию — она появится здесь', en: 'Finish your first session and it will appear here' },
  archive_subtitle: { ru: 'Архив свободного письма. Каждая запись — слепок одного дня.', en: 'Archive of free writing. Each entry is a snapshot of one day.' },
  archive_count: { ru: 'записей', en: 'entries' },
  archive_tags_label: { ru: 'теги', en: 'tags' },
  archive_tags_reset: { ru: 'сбросить', en: 'reset' },
  archive_continue_writing: { ru: 'Продолжить писать', en: 'Continue writing' },
  archive_export: { ru: 'Экспортировать', en: 'Export' },
  archive_no_content: { ru: 'Содержимое недоступно', en: 'Content unavailable' },
  archive_stat_docs: { ru: 'заметок', en: 'notes' },
  archive_stat_words: { ru: 'всего слов', en: 'total words' },
  archive_stat_mins: { ru: 'минут', en: 'minutes' },
  archive_stat_streak: { ru: 'дней подряд', en: 'day streak' },
  archive_delete: { ru: 'Удалить заметку', en: 'Delete note' },
  archive_delete_confirm: { ru: 'Удалить эту заметку?', en: 'Delete this note?' },
  archive_entry_1: { ru: 'запись', en: 'entry' },
  archive_entry_2: { ru: 'записи', en: 'entries' },
  archive_entry_5: { ru: 'записей', en: 'entries' },
  archive_sidebar_title: { ru: 'Архив', en: 'Archive' },
  archive_calendar_title: { ru: 'Календарь', en: 'Calendar' },
  archive_preview: { ru: 'Предпросмотр', en: 'Preview' },
  error_generic: { ru: 'Что-то пошло не так', en: 'Something went wrong' },
  error_continue_session: { ru: 'Ошибка при продолжении сессии', en: 'Error continuing session' },
  error_reload: { ru: 'Перезагрузить', en: 'Reload' },
  admin_access_denied:      { ru: 'Доступ запрещён',        en: 'Access Denied' },
  admin_import_title:       { ru: 'Импорт из облака в локальное хранилище', en: 'Import from cloud to local storage' },
  admin_import_hint:        { ru: 'Скачивает все облачные документы в IndexedDB этого устройства.', en: 'Downloads all cloud documents to this device\'s IndexedDB.' },
  admin_import_button:      { ru: 'Импортировать из облака', en: 'Import from cloud' },
  admin_importing:          { ru: 'Импортирую...', en: 'Importing...' },
  admin_import_done:        { ru: 'Импортировано {imported} из {total} документов', en: 'Imported {imported} of {total} documents' },
  admin_import_failed:      { ru: 'Ошибок: {count}', en: 'Failed: {count}' },
  admin_security_xss_title: { ru: 'XSS защита',             en: 'XSS Protection' },
  admin_security_csrf_title:{ ru: 'CSRF защита',            en: 'CSRF Protection' },
  profile_activity_title:   { ru: 'Активность',             en: 'Activity' },
  data_export_all:          { ru: 'Экспортировать всё',      en: 'Export All Sessions' },
  writing_go:               { ru: 'ПОЕХАЛИ!',               en: 'GO!' },
  auth_email:               { ru: 'Email',                  en: 'Email' },
  auth_email_placeholder:   { ru: 'ваш@email.com',          en: 'your@email.com' },
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  tp: (key: string, count: number) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('app_language');
    if (saved === 'ru' || saved === 'en') return saved as Language;
    return 'ru';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('app_language', lang);
  };

  const t = (key: string, params?: Record<string, string | number>): string => {
    let str = translations[key]?.[language] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
    }
    return str;
  };

  const tp = useCallback((key: string, count: number): string => {
    const getPluralSuffix = (n: number, lang: Language): string => {
      if (lang === 'ru') {
        const mod10 = n % 10;
        const mod100 = n % 100;
        if (mod100 >= 11 && mod100 <= 14) return '_many';
        if (mod10 === 1) return '_one';
        if (mod10 >= 2 && mod10 <= 4) return '_few';
        return '_many';
      }
      return n === 1 ? '_one' : '_other';
    };

    const suffix = getPluralSuffix(count, language);
    const fullKey = `${key}${suffix}`;
    const fallbackKey = language === 'en' && suffix === '_other' ? `${key}_many` : null;
    let str = translations[fullKey]?.[language] 
      ?? (fallbackKey ? translations[fallbackKey]?.[language] : undefined)
      ?? translations[key]?.[language] 
      ?? key;
    return str.replace('{count}', String(count));
  }, [language]);

  const tpFn = useCallback((key: string, count: number) => tp(key, count), [tp]);

  React.useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, tp: tpFn }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
