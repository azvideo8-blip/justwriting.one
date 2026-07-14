# Отчет об исправлении ошибок в JustWriting от 14.07.2026

В ходе двух волн аудита и оптимизации кодовой базы приложения JustWriting были устранены 18 критических и важных дефектов в ИИ-слое, безопасности данных, архитектуре, локальной и облачной синхронизации, логике расчета прогресса и оффлайн-режиме.

---

## Волна 1: ИИ-слой, Безопасность и Архитектура

### 1. Безопасность: Валидация App Check токена в Edge API
- **Файл:** [chat.ts](file:///Users/andreyzubkov/justwriting/api/chat.ts)
- **Что сделано:** Добавлена интеграция `getAppCheck` из `firebase-admin/app-check`. Если в переменных среды включен флаг `APP_CHECK_ENFORCE === 'true'`, сервер проверяет заголовок `X-Firebase-AppCheck`. Невалидные или отсутствующие токены отклоняются со статусом `401 Unauthorized`.

---

### 2. ИИ-слой: Ограничение Bulk-операций на уровне пользователя
- **Файлы:** 
  - [aiUtils.ts](file:///Users/andreyzubkov/justwriting/functions/src/shared/aiUtils.ts) (реализация лимитов)
  - [embedDocument.ts](file:///Users/andreyzubkov/justwriting/functions/src/ai/embedDocument.ts)
  - [summarizeDocument.ts](file:///Users/andreyzubkov/justwriting/functions/src/ai/summarizeDocument.ts)
  - [deriveTaxonomy.ts](file:///Users/andreyzubkov/justwriting/functions/src/ai/deriveTaxonomy.ts)
  - [judgeFacets.ts](file:///Users/andreyzubkov/justwriting/functions/src/ai/judgeFacets.ts)
  - [rerankNotes.ts](file:///Users/andreyzubkov/justwriting/functions/src/ai/rerankNotes.ts)
  - [summarizeFacet.ts](file:///Users/andreyzubkov/justwriting/functions/src/ai/summarizeFacet.ts)
  - [extractChatMemory.ts](file:///Users/andreyzubkov/justwriting/functions/src/ai/extractChatMemory.ts)
- **Что сделано:** Внедрен отдельный суточный лимит `checkAndIncrementBulkLimit(uid)` (по умолчанию 50 фоновых операций в день на пользователя) для всех вспомогательных ИИ-вызовов (поиск, эмбеддинги, классификация фасетов, суммаризация заметок). В случае ошибок вызова лимит корректно возвращается пользователю через `refundBulkLimit`.

---

### 3. Архитектура: Распределенные счетчики (Sharding) для глобальных лимитов
- **Файлы:**
  - [aiUtils.ts](file:///Users/andreyzubkov/justwriting/functions/src/shared/aiUtils.ts)
  - [chat.ts](file:///Users/andreyzubkov/justwriting/api/chat.ts)
  - [resetUserLimit.ts](file:///Users/andreyzubkov/justwriting/functions/src/admin/resetUserLimit.ts)
- **Что сделано:** Глобальная суточная статистика переведена с одного документа на коллекцию из 10 шардов. Это полностью устраняет точку отказа (Hotspot) при одновременных записях со стороны множества пользователей. При чтении лимитов показатели шардов суммируются, при записи — увеличивается случайный шард с помощью атомарного `FieldValue.increment`.

---

### 4. Архитектура: Синхронизация ИИ-политики
- **Файлы:**
  - [aiPolicy.ts](file:///Users/andreyzubkov/justwriting/src/shared/ai/aiPolicy.ts) (Новый зеркальный файл)
  - [chat.ts](file:///Users/andreyzubkov/justwriting/api/chat.ts)
- **Что сделано:** Создана общая копия политик ограничений внутренних вызовов, которая импортируется в Edge API. Дублировавшиеся ручные проверки в [chat.ts](file:///Users/andreyzubkov/justwriting/api/chat.ts) заменены на вызов `validateInternalCallRestrictions` и `getMaxTokens`.

---

### 5. ИИ-слой: Исправление опечатки DOMPurify
- **Файл:** [aiUtils.ts](file:///Users/andreyzubkov/justwriting/functions/src/shared/aiUtils.ts)
- **Что сделано:** Исправлен тернарный оператор в `sanitizeAiResponse`. Теперь при `keepReasoning === true` DOMPurify сохраняет теги `<reasoning>` и `<answer>`, что возвращает работоспособность режиму рассуждений.

---

### 6. ИИ-слой: Очистка Markdown в `rerankNotes`
- **Файл:** [rerankNotes.ts](file:///Users/andreyzubkov/justwriting/functions/src/ai/rerankNotes.ts)
- **Что сделано:** Перед парсингом ответа модели добавлена предварительная очистка markdown-оберток (тройных обратных кавычек ` ```json ... ``` `). Это гарантирует, что ответ модели не вызовет падение парсера JSON.

---

### 7. ИИ-слой: Ошибка экранирования в `repairTruncatedJson`
- **Файлы:**
  - [summarizeDocument.ts](file:///Users/andreyzubkov/justwriting/functions/src/ai/summarizeDocument.ts)
  - [deriveTaxonomy.ts](file:///Users/andreyzubkov/justwriting/functions/src/ai/deriveTaxonomy.ts)
  - [judgeFacets.ts](file:///Users/andreyzubkov/justwriting/functions/src/ai/judgeFacets.ts)
- **Что сделано:** Исправлен алгоритм восстановления обрезанных JSON-строк. Если строка обрывалась прямо на символе экранирования (`\\`), он удаляется перед добавлением закрывающей кавычки. Это предотвращает возникновение невалидной последовательности `\"`.

---

### 8. Администрирование: Увеличение Safety-лимитов
- **Файл:** [resetUserLimit.ts](file:///Users/andreyzubkov/justwriting/functions/src/admin/resetUserLimit.ts)
- **Что сделано:** Константа `MAX_DAILY_REQUESTS_SAFETY` повышена с 500 до 10 000, что соответствует реальным масштабам суточных ограничений и позволяет администраторам сбрасывать пользовательские лимиты.

---

## Волна 2: Ядро, Синхронизация, Шифрование и Часовые пояса

### 9. Накопление времени написания в сессиях
- **Файлы:**
  - [LocalStorageService.ts](file:///Users/andreyzubkov/justwriting/src/core/services/LocalStorageService.ts)
  - [StorageService.ts](file:///Users/andreyzubkov/justwriting/src/core/services/StorageService.ts)
- **Что сделано:** Сохранение `totalDuration` в документе переведено на накапливаемое: `(existing.totalDuration || 0) + data.duration` вместо затирания. В `StorageService.ts` в метод обновления профиля передается корректная накопленная длительность.

---

### 10. Валидация UID владельца при фоновой синхронизации портрета
- **Файл:** [SyncService.ts](file:///Users/andreyzubkov/justwriting/src/core/services/SyncService.ts)
- **Что сделано:** В метод `_drainPendingQueue` добавлена проверка UID: если задача синхронизации портрета создана пользователем, отличным от текущего авторизованного, она безопасно пропускается и удаляется из очереди. Также исправлен интеграционный тест [SyncService.integration.test.ts](file:///Users/andreyzubkov/justwriting/src/core/services/__tests__/SyncService.integration.test.ts) для использования согласованного `userId`.

---

### 11. Корректный парсинг YAML Frontmatter с Windows CRLF переносами строк
- **Файл:** [archiveImport.ts](file:///Users/andreyzubkov/justwriting/src/features/archive/services/archiveImport.ts)
- **Что сделано:** Разделение строк в YAML теперь производится с помощью регулярного выражения `split(/\r?\n/)` вместо `split('\n')`. Это предотвращает загрязнение значений YAML-метаданных (таких как `title` или `tags`) символами возврата каретки `\r`.

---

### 12. Поддержка дедлайнов (Finish-By) после полуночи
- **Файлы:**
  - [WritingSetup.tsx](file:///Users/andreyzubkov/justwriting/src/features/writing/components/WritingSetup.tsx)
  - [MobileSessionSetupSheet.tsx](file:///Users/andreyzubkov/justwriting/src/features/writing/components/MobileSessionSetupSheet.tsx)
  - [useSessionFlow.ts](file:///Users/andreyzubkov/justwriting/src/features/writing/hooks/useSessionFlow.ts)
  - [useTimerStore.ts](file:///Users/andreyzubkov/justwriting/src/features/writing/store/useTimerStore.ts)
- **Что сделано:** Добавлен автоматический перенос целевого дедлайна на следующие сутки, если выбранное время в прошлом относительно старта сессии (переход через полночь). Это исключает блокировку запуска сессии и моментальное срабатывание таймера дедлайна.

---

### 13. Таймауты на ИИ-запросы Taxonomy и Judge
- **Файл:** [AIService.ts](file:///Users/andreyzubkov/justwriting/src/features/ai/services/AIService.ts)
- **Что сделано:** Вызовы облачных функций `deriveTaxonomy` и `judgeFacets` теперь оборачиваются в `withTimeout` с ограничением в 60 секунд, предотвращая бесконечную загрузку интерфейса при сетевых сбоях.

---

### 14. Фоновый опрос для восстановления оффлайн-подключения
- **Файл:** [firestore.ts](file:///Users/andreyzubkov/justwriting/src/core/firebase/firestore.ts)
- **Что сделано:** После исчерпания 3 быстрых попыток подключения к Firestore процесс пинга не останавливается, а переходит в фоновый режим с интервалом в 60 секунд. Это позволяет приложению автоматически восстанавливать онлайн-статус при возвращении сети.

---

### 15. Своевременный триггер хука миграции E2E-ключей
- **Файл:** [useEncryptionSetup.ts](file:///Users/andreyzubkov/justwriting/src/features/encryption/hooks/useEncryptionSetup.ts)
- **Что сделано:** Объявлен `prevProfileRef`, а объект Firestore `profile` добавлен в массив зависимостей хука инициализации шифрования. Проверка наличия старых ключей перезапускается при загрузке данных профиля, а не только при смене UID.

---

### 16. Обработка DecryptionError при загрузке документов
- **Файл:** [UnifiedSessionLoader.ts](file:///Users/andreyzubkov/justwriting/src/features/writing/services/UnifiedSessionLoader.ts)
- **Что сделано:** В загрузчике сессий добавлена обработка `DecryptionError`. При ошибке дешифрации сессии выставляется флаг `cloudDecryptError = true` вместо общей ошибки контента, позволяя интерфейсу корректно обрабатывать заблокированное состояние сейфа.

---

### 17. Синхронизация выигравшего облачного черновика в IndexedDB
- **Файл:** [WritingDraftService.ts](file:///Users/andreyzubkov/justwriting/src/features/writing/services/WritingDraftService.ts)
- **Что сделано:** В методе `loadDraft`, если облачный черновик оказывается новее или локальный черновик отсутствует, он записывается в IndexedDB через `saveToLocal`, предотвращая потерю облачных правок при переходе в оффлайн.

---

### 18. Устранение таймзон-зависимости в расчете серий (Streak)
- **Файл:** [utils.ts](file:///Users/andreyzubkov/justwriting/src/core/utils/utils.ts)
- **Что сделано:** В методе `calculateBestStreak` парсинг дат `'yyyy-MM-dd'` теперь производится локально, а прибавление 1 дня для вычисления пропущенных дат выполняется через вызовы локального времени. Это защищает от сбоев расчета серий у пользователей в часовых поясах западнее UTC.

---

### 19. Исправление уязвимости TOCTOU в лимитах запросов (Транзакции)
- **Файлы:**
  - [aiUtils.ts](file:///Users/andreyzubkov/justwriting/functions/src/shared/aiUtils.ts)
  - [chat.ts](file:///Users/andreyzubkov/justwriting/api/chat.ts)
  - [aiUtils.emulator.test.ts](file:///Users/andreyzubkov/justwriting/functions/src/__tests__/emulator/aiUtils.emulator.test.ts)
- **Что сделано:** Функция `tryReserveGlobalRequest` переведена на использование Firestore-транзакций (`runTransaction`) для атомарной проверки лимитов и резервирования слота. Шардированные счетчики больше не подвержены рассинхронизации в условиях конкурентных запросов. Эмуляционный тест гонки TOCTOU обновлен для верификации строгого соблюдения ограничений.

---

## Результаты тестирования

### Автоматические тесты
1. **Фронтенд и Core-сервисы:**
   - Результат: **638 / 638 тестов пройдены успешно**.
2. **Cloud Functions:**
   - Результат: **59 / 59 тестов пройдены успешно**.
