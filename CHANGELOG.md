# Changelog

## 2026-05-24 (v0.6.5)
- **[RU]** Исправлены все 22 тикета надежности, архитектуры и обработки ошибок. Внедрено полное тестовое покрытие для Firestore-сервисов (`DocumentService`, `VersionService`) и хука `useDocuments`. Устранена циклическая зависимость Timer ↔ Content.
- **[EN]** Resolved all 22 reliability, architectural, and error-handling tickets. Implemented comprehensive test coverage for Firestore services (`DocumentService`, `VersionService`) and `useDocuments` hook. Cleared circular dependencies between Timer and Content.

## 2026-05-23 (v0.6.4)
- **[RU]** Исправлены все оставшиеся замечания Code Review Round 2 (безопасность App Check, Mood Check-in сэйвы, рефакторинг дублирования store/helpers).
- **[EN]** Resolved all remaining Code Review Round 2 issues (App Check security, Mood Check-in saves, unified draft helpers).

## 2026-03-25
- **[EN]** Added "Finish by..." smart timer mode with countdown and progress bar.
- **[RU]** Добавлен умный таймер «Закончить к...» с обратным отсчетом и прогресс-баром.
- **[EN]** Implemented "Fully Local" mode and client-side encryption (AES-256) for notes.
- **[RU]** Внедрен режим «Полностью локально» и сквозное шифрование (AES-256) заметок.
