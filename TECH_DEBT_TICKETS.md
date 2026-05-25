# Tech Debt Tickets — незакрытые пункты из 6-sprint audit

---

## TD-01 — Виртуализация списка сессий в архиве (P0)

**Sprint 3 план:** виртуализация. **Факт:** не сделано.

**Проблема:** `ArchiveNoteList.tsx` рендерит все сессии в DOM сразу. При 200+ записях — лаги скролла, избыточный memory footprint.

**Исправление:**
Добавить `react-virtuoso` (или `@tanstack/react-virtual`):
```bash
npm install react-virtuoso
```

В `ArchiveNoteList.tsx` заменить `<div className="flex flex-col">` с map на `<Virtuoso>`:
```tsx
import { Virtuoso } from 'react-virtuoso';

<Virtuoso
  data={filteredSessions}
  itemContent={(_, session) => <NoteRow session={session} ... />}
/>
```

Для grid-режима — `<VirtuosoGrid>`.

**Важно:** виртуализация несовместима с `LayoutGroup` от Framer Motion (layoutId анимации). Нужно убрать `layoutId` с виртуализированных элементов или отключить layout-анимации при большом списке.

---

## TD-02 — Дублирующиеся системы автосохранения черновиков (P1)

**Sprint 5 план:** унификация `useDraftAutosave` + `useDraftManager`. **Факт:** обе системы живут параллельно.

**Текущее состояние:**
- `useDraftAutosave` — используется в `useSessionPersistence` (cloud-сессии)
- `useDraftManager` — используется в `useGuestWritingSession` (guest-сессии)

Похожая логика: интервал сохранения, восстановление черновика, статус `saving/saved`.

**Исправление:**
Создать `src/features/writing/hooks/useDraftCore.ts` с общей логикой (интервал, статус, dirty-флаг). Обе системы используют его как примитив. Не объединять в один хук — поведение cloud и guest различается достаточно.

---

## TD-03 — AccountTab 613 строк: выделить EncryptionService (P0)

**Sprint 5 план:** `EncryptionService` в `core/crypto/`. **Sprint 3 план:** разбить AccountTab. **Факт:** 613 строк, vault-операции внутри.

**Исправление:**

**Шаг 1 — EncryptionService:**
Создать `src/core/crypto/EncryptionService.ts`:
- Перенести из AccountTab: `encryptVault`, `decryptVault`, `changePassword`, `exportVault`, `importVault`
- Экспортировать как object (паттерн как AuthService)

**Шаг 2 — разбить AccountTab на подкомпоненты:**
```
AccountTab.tsx (~100 строк, только склейка)
├── AccountProfileSection.tsx  — аватар, имя, email
├── AccountVaultSection.tsx    — шифрование, пароль
├── AccountDangerSection.tsx   — удаление аккаунта, экспорт данных
└── AccountSubscriptionSection.tsx — план, лимиты
```

---

## TD-04 — WritingFinishModal 692 строки: разбить (P2)

**Sprint 3 план:** разбить на 5 подкомпонентов. **Факт:** 692 строки нетронуто.

**Исправление:**
```
WritingFinishModal.tsx (~100 строк, только склейка + useFocusTrap)
├── FinishModalStats.tsx       — счётчики слов, время, WPM
├── FinishModalWpmChart.tsx    — график WPM (уже lazy-loaded)
├── FinishModalExport.tsx      — кнопки экспорта PDF/MD/TXT
├── FinishModalTags.tsx        — теги и метки сессии
└── FinishModalStreaks.tsx     — streak dots, достижения
```

---

## TD-05 — StorageService: убрать `as Record<string, unknown>` касты (P1)

**Sprint 4 план:** типизированные encrypt/decrypt. **Факт:** 3 места с `as unknown as Record<string, unknown>` в `src/core/services/StorageService.ts` (строки 123, 222, 441).

**Исправление:**
Создать типизированные обёртки для `maybeEncrypt`/`maybeDecrypt`:
```ts
async function encryptSession(session: Session, userId: string): Promise<EncryptedSession>
async function decryptSession(raw: EncryptedSession, userId: string): Promise<Session>
```

Убрать `as unknown as Record<string, unknown>` — заменить на правильные типы.

---

## TD-06 — Поиск обрезает контент на 200 символов (P2)

**Sprint 3 план:** поиск по полному контенту. **Факт:** `NoteRow.tsx:249` — `session.content.slice(0, 200)`.

**Проблема:** поиск находит сессию (ищет по полному тексту в Firestore/IDB), но highlight в NoteRow показывает только первые 200 символов. Если ключевое слово дальше — подсветка не видна, пользователь не понимает почему карточка попала в результаты.

**Исправление в `NoteRow.tsx`:**
При наличии `searchQuery` — найти позицию вхождения в полном тексте и показать контекст вокруг него:
```ts
const getSearchContext = (content: string, query: string, contextLen = 120) => {
  if (!query) return content.slice(0, 200);
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return content.slice(0, 200);
  const start = Math.max(0, idx - contextLen / 2);
  return (start > 0 ? '...' : '') + content.slice(start, start + contextLen + query.length) + '...';
};
```

---

## TD-07 — Тесты: незакрытые P0 из Sprint 6

**Sprint 6 план:** тесты для критических хуков и сервисов. **Факт:** тестовая инфраструктура создана (mocks, factories, render utils), но сами тесты не написаны.

**Что нужно написать:**

| Файл теста | Что тестировать | Приоритет |
|---|---|---|
| `hooks/__tests__/useBaseWritingSession.test.ts` | start/pause/stop/wordCount increment | P0 |
| `hooks/__tests__/useSessionFlow.test.ts` | idle→writing→paused→finished state machine | P0 |
| `services/__tests__/SessionDeleteService.test.ts` | удаление + rollback при ошибке | P0 |
| `services/__tests__/WritingSessionService.test.ts` | save, load, update | P1 |
| `services/__tests__/WritingDraftService.test.ts` | сохранение черновика, восстановление | P1 |
| `auth/__tests__/AuthContext.test.ts` | login, logout, onSnapshot reconnect | P1 |
| `app/__tests__/ProtectedRoute.test.ts` | redirect неавторизованного | P1 |

Инфраструктура: `src/test/mocks/firebase.ts`, `src/test/factories/index.ts`, `src/test/utils/render.tsx` — уже готовы, использовать их.

---

## TD-08 — Дедупликация загрузки данных профиля (P1)

**Sprint 3 план:** shared cache для ProfilePage + MobileMeScreen. **Факт:** обе страницы загружают сессии независимо.

**Проблема:** `ProfilePage` и `MobileMeScreen` делают одинаковые запросы к Firestore при каждом монтировании. Переход desktop↔mobile дублирует запросы.

**Исправление:**
Создать `src/features/profile/hooks/useProfileStats.ts`:
```ts
export function useProfileStats(userId: string) {
  // единый источник: sessions, stats, streak
  // внутри — React Query или SWR с кешем, или простой useState + useRef для дедупликации
}
```

Обе страницы используют `useProfileStats` вместо прямых вызовов.

---

## Приоритеты

| Тикет | Приоритет | Оценка |
|-------|-----------|--------|
| TD-01 Виртуализация | 🔴 P0 | 6–8ч |
| TD-03 AccountTab + EncryptionService | 🔴 P0 | 6–8ч |
| TD-02 Draft unification | 🟡 P1 | 3–4ч |
| TD-05 StorageService types | 🟡 P1 | 2–3ч |
| TD-07 Тесты P0 | 🟡 P1 | 6–8ч |
| TD-08 Profile stats dedup | 🟡 P1 | 3–4ч |
| TD-06 Search context | 🟢 P2 | 1–2ч |
| TD-04 WritingFinishModal split | 🟢 P2 | 3–4ч |
