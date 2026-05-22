# Tickets: Cloud Sync Bug + Error Monitoring

---

## БАГ-111 — UnlockPrompt показывается и падает для пользователей без шифрования

**Приоритет:** 🔴 Критический (блокирует upload в облако для части пользователей)
**Оценка:** 1.5 часа
**Файлы:** `src/features/writing/components/StorageIcons.tsx`, `src/features/auth/components/UnlockPrompt.tsx`

### Что происходит

Пользователь нажимает кнопку «облако» → видит промпт "Разблокировать шифрование" → вводит пароль → "Что-то пошло не так".

### Цепочка

```
StorageIcons.handleCloudClick
  → getSessionKey() === null   ← true у всех после рефреша И у всех без шифрования
  → показывает UnlockPrompt

UnlockPrompt.handleUnlock
  → getDoc('users', uid)
  → !data.encryptionSalt || !data.encryptedDataKey   ← у старых/незашифрованных пользователей
  → setError(t('error_generic'))  → "Что-то пошло не так"
```

### Почему у пользователей нет ключей

`AuthContext` уже загружает `profile` из Firestore — `UserProfile` содержит `encryptionSalt?: string` и `encryptedDataKey?: string` (см. `src/shared/types/common.ts:22-23`). При логине `setSessionKey` вызывается только если оба поля есть (LoginPage строка 100):

```ts
if (profileData.encryptionSalt && profileData.encryptedDataKey) {
  setSessionKey(dataKey); // ← только тут
}
// иначе sessionKey остаётся null навсегда
```

Пользователи, зарегистрированные до внедрения шифрования, или у которых не сохранились ключи при регистрации — имеют `getSessionKey() === null` всегда. Для них:
- UnlockPrompt показывать нельзя (ключей нет)
- Загрузку в облако нужно разрешать (данные и так не шифровались)

### Решение

**Часть 1 — StorageIcons: показывать UnlockPrompt только если у пользователя есть шифрование**

```ts
// Добавить в props:
hasEncryption: boolean;

// handleCloudClick — изменить логику:
if (!getSessionKey()) {
  if (hasEncryption) {
    // Ключ должен быть, но потерян после рефреша → UnlockPrompt
    reportError('ENCRYPT_REQUIRED: session key missing on cloud upload', { userId });
    setShowUnlock(true);
  }
  // Если hasEncryption === false → просто продолжаем, maybeEncrypt не зашифрует (required=false)
  // НО: см. Часть 3 про required=true
  return; // убрать этот return когда hasEncryption === false
}
```

Итого правило:
- `!getSessionKey() && hasEncryption` → показать UnlockPrompt
- `!getSessionKey() && !hasEncryption` → продолжить upload (не шифровать)

**Часть 2 — Передавать hasEncryption из родителя**

В компоненте где рендерится `StorageIcons` (архив, NoteRow) — получить из `useAuth()`:

```ts
const { profile } = useAuth();
const hasEncryption = !!(profile?.encryptionSalt && profile?.encryptedDataKey);

<StorageIcons
  doc={doc}
  userId={userId}
  hasEncryption={hasEncryption}
  onStorageChange={onStorageChange}
/>
```

**Часть 3 — StorageService.addCloudCopy: не требовать шифрование если у пользователя нет ключей**

Сейчас `maybeEncrypt` вызывается с `required: true` (строки 191 и 355). Для пользователей без шифрования это бросает `ENCRYPT_REQUIRED`.

Передавать `encryptionRequired` в `addCloudCopy`:

```ts
// StorageService:
async addCloudCopy(userId: string, localDocumentId: string, encryptionRequired = false): Promise<string>

// Вызов maybeEncrypt:
const versionPayload = await maybeEncrypt({...}, ['content', 'previousContent'], [], encryptionRequired);
```

Вызывать с `encryptionRequired = hasEncryption`:
```ts
const cloudId = await StorageService.addCloudCopy(userId, doc.localId, hasEncryption);
```

**Часть 4 — UnlockPrompt: понятная ошибка если ключей нет в Firestore**

На случай если UnlockPrompt всё же откроется для пользователя без ключей (race condition или прямой вызов):

```ts
if (!data.encryptionSalt || !data.encryptedDataKey) {
  // Не generic — конкретное объяснение
  setError(t('unlock_no_keys_error'));
  setLoading(false);
  return;
}
```

Новый ключ перевода в `common.ts`:
```ts
unlock_no_keys_error: {
  ru: 'Ключи шифрования не найдены. Выйдите из аккаунта и войдите снова.',
  en: 'Encryption keys not found. Please sign out and sign in again.',
},
```

### Критерий готовности

- Пользователь без шифрования нажимает «облако» → upload идёт сразу, без UnlockPrompt
- Пользователь с шифрованием после рефреша → UnlockPrompt, пароль → upload
- Неверный пароль → "Неверный пароль" (уже работает)
- Нет ключей в Firestore → "Ключи шифрования не найдены. Выйдите..." (не generic)

---

## БАГ-112 — Ошибки пользователей не мониторятся: Sentry не настроен

**Приоритет:** 🟡 Высокий
**Оценка:** 1 час
**Файлы:** `src/main.tsx`, `.env.local`

### Проблема

В `reportError.ts` Sentry подключён, но `VITE_SENTRY_DSN` пустой в `.env.local`. Все ошибки идут только в `console.error` — невидимы в продакшне.

### Решение

**1. Завести проект в Sentry:**

sentry.io → Create Project → React. Бесплатный план: 5000 ошибок/месяц.

Добавить в `.env.local`:
```
VITE_SENTRY_DSN=https://xxxxxxx@o0.ingest.sentry.io/0000000
```

**2. Проверить инициализацию в `main.tsx` (уже добавлена в коммите 21255c5):**

Убедиться что `beforeSend` не передаёт content заметок, `enabled: import.meta.env.PROD`.

**3. Добавить Sentry.setUser в AuthContext (уже в коммите):**

Проверить что при логауте вызывается `Sentry.setUser(null)`.

### Критерий готовности

- В Sentry dashboard видны ошибки из продакшн-сборки
- Dev-режим не отправляет ничего в Sentry
- userId виден в Sentry для каждой ошибки (без email)
- Ошибка БАГ-111 (ENCRYPT_REQUIRED) отображается в Sentry с контекстом
