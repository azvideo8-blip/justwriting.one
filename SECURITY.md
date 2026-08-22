# Security Documentation

## Postulates

Four statements the whole design answers to. When a change conflicts with one of
them, the change is wrong — not the postulate.

1. **What a person writes locally is never lost** — except when they themselves
   choose to delete it. A failed read, a half-finished write, a locked vault or a
   parse error must never be rendered as absence of data, and must never be
   written back as truth. This is the recurring bug class in this codebase; every
   fix for it carries a regression test.
2. **Nothing leaves for the cloud unencrypted.** Notes, titles, tags, labels,
   analyses, embeddings, dialogues, the portrait — everything the person wrote,
   or that was concluded about them, is encrypted with a key derived on their
   device. A new field that syncs is encrypted before it syncs, not after someone
   notices.
3. **AI is the one disclosed exception.** Analysis requires sending the text to
   the provider in the clear; there is no way around it today. The person is told
   so plainly, decides for themselves, and loses no other functionality by
   declining.
4. **Saved, encrypted, synchronised, nothing leaked** — apart from what the
   person deliberately sent for analysis.


## Role Model
The application uses a role-based access control (RBAC) system defined in Firestore:
- `user`: Standard user, can manage their own sessions and profile.
- `admin`: Elevated privileges, can view all sessions and manage users.

**Admin Assignment:** Admin roles are strictly assigned manually via the Firebase Console. The client cannot mutate the `role` field.

Roles are stored in the `users` collection within the `role` field. The `AuthService` acts as the single source of truth for role-checking logic on the client side, while Firestore rules and Cloud Functions enforce these roles on the backend.

## Data Isolation
- **User Data**: Users can only access their own profile and sessions.
- **Session Data**: Sessions are private by default, unless explicitly set to `isPublic: true`.
- **Admin Access**: Admins have read access to all sessions and user profiles.

## Firestore Security Rules

Our Firestore rules are designed with the principle of "Least Privilege". Security is enforced at the database level.

### Key Principles:
- **Role-Based Access Control (RBAC):** Admin access is strictly controlled via the `role` field in the user's Firestore document. No hardcoded emails are used.
- **Strict User Isolation:** Users can only read, update, or delete their own sessions. Update and delete operations strictly require `request.auth.uid == resource.data.userId`.
- **Public Feed Logic:** Any "Public Feed" logic only allows read access for `isPublic == true` and explicitly prevents write access by non-owners.
- **Data Validation:** All input fields (content, title, tags) are validated for type and size to prevent malicious payloads and DoS attacks.
- **Default Deny:** All access is denied by default unless explicitly allowed.
- **Role Protection:** The `role`, `uid`, and `email` fields are explicitly excluded from client-side updates.

## Encryption

AES-256-GCM encryption with PBKDF2 key derivation:
1. User password → PBKDF2 (300K iterations, SHA-256) → Master Key (AES-KW, `extractable: false`)
2. Random Data Key (AES-256-GCM) generated per user
3. Data Key wrapped with Master Key → stored in Firestore
4. Content encrypted with Data Key (12-byte CSPRNG IV per encryption)
5. Verification plaintext encrypted for key validation
6. Session key held in memory (useEncryptionStore) while vault is unlocked
7. **Auto-lock:** CryptoKey is automatically cleared after 15 minutes of inactivity or on tab visibility change. `secureClear` zeros sensitive byte arrays after use. CryptoKey objects cannot be zeroed from JavaScript (platform limitation — cleared on GC).
8. **Legacy vault unlock:** On `OperationError` (wrong password), the vault returns `false` — encryption is NOT silently enabled without a valid data key.
9. **Device Key Vault (SEC-15):** Optional "remember on device" caches non-extractable AES keys in IndexedDB via WebCrypto API. While keys cannot be read directly via JavaScript, any same-origin script executing in the browser origin could trigger decryption. Users opting into device key caching are informed of this threat model.
10. **Signup Salt & Key Handling (SEC-16):** Temporary enrollment parameters (`encryptionSalt`, `encryptedDataKey`) held in `sessionStorage` during registration are cleared immediately upon account creation or tab closure.

## Cloud Functions Security

All AI functions enforce:
- **Authentication:** Firebase Auth verified ID token required before processing.
- **Payload Validation:** Zod schema validation on every endpoint. Content limited to 50,000 characters.
- **Action Validation:** Predefined list of allowed actions.
- **Prompt Injection Guard:** `INJECTION_PATTERNS` (15 patterns, shared between Edge API and Cloud Functions) checked against custom system prompts and user messages.
- **Input Sanitization:** `sanitizeAiInput` removes special token markers (`<|system|>`, `<|im_start|>`, `[INST]`, `<developer>`, etc.).
- **Output Sanitization:** `sanitizeAiResponse` (DOMPurify, strips all HTML) applied to all Cloud Function AI responses.
- **Rate Limiting:** Per-user daily limit (5-50 requests/day, admin: 100) + 10s cooldown + project-wide daily cap (10K requests/day). Limit refund on AI failures prevents quota burn from transient errors.
- **Error Handling:** AI API calls wrapped in try-catch to prevent internal errors from leaking to the client. Generic error messages returned to client.

## Vercel Edge API (`/api/chat`)

- **Auth:** Bearer token (Firebase ID) verified via Admin SDK.
- **Validation:** Zod schema validation, same as Cloud Functions.
- **Injection Guard:** Same `INJECTION_PATTERNS` (imported from `src/shared/ai/injectionPatterns.ts`) applied to custom prompts and user messages.
- **Streaming:** AI output is streamed directly to the client. **Security constraint:** The client-side `MarkdownRenderer` must never add `rehype-raw` — it would re-enable XSS from unsanitized streaming output. Only `rehype-sanitize` is used (strips all raw HTML). This is documented in the component source.

## App Check

> **Status:** App Check is wired up on the client, but enforcement is **off** on all callable functions and the Edge API (`enforceAppCheck: false`). Endpoints are protected by Firebase Auth + rate limits. Enabling enforcement is planned after the Supabase migration.

## Content Security Policy

Comprehensive CSP headers configured in `vercel.json`:
- HSTS (`max-age=63072000; includeSubDomains; preload`)
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy (camera, microphone, geography disabled)
- COOP, CORP, frame-ancestors: none, object-src: none
- Firebase API keys in client are acceptable — restricted by Firebase security rules.

## Analytics & Error Reporting

- **PostHog:** Opt-in only (`hasConsent()` check). `analytics.track()`, `trackEvent()`, and `webVitals` all verify consent before sending data. `person_profiles: 'identified_only'`.
- **Sentry & Activity Log:** `maskAllText: true`, `blockAllMedia: true`. User identified by UID only. PII keys are stripped by `reportError` before anything is stored: identifiers (`userId`, `uid`, `email`, `linkedCloudId`, `documentId`, `docId`, `docUuid`, `localId`, `versionId`, `sessionId`, `personaId`, `domainId`, `labelId`, `noteId`, `threadId`) and anything the person wrote (`title`, `docTitle`, `content`, `text`, `rawContent`, `summary`, `tag`, `theme`, `label`, `name`, `query`, `snippet`, `prompt`, `answer`, `message`). Redaction matches the exact key name, so the list covers whole families: `docId` next to `documentId` is the same identifier under another name. These are stripped before entering `activity_log_v1` in `localStorage` or Sentry.
- **Langfuse:** AI request observability (tokens, model, usage). No user note content or model generation text stored — only metadata and token metrics.

## Shared Injection Patterns

Injection patterns are maintained in a single source: `src/shared/ai/injectionPatterns.ts`. Both `api/chat.ts` (Vercel Edge) and `functions/src/shared/aiUtils.ts` (Cloud Functions) import from this file. A parity test exists at `src/features/ai/shared/__tests__/injectionPatterns.test.ts`.

> **Note:** Cloud Functions maintain a mirror copy with a "keep in sync" comment due to separate `rootDir`/`tsconfig.json`. After Supabase migration, both sides will import from a single shared package.

## Известные компромиссы (документированные)

- **Черновик сессии в IndexedDB лежит plaintext у E2E-юзеров** (#84, вариант B).
  Черновик — автосейв рабочего состояния, а не хранимая заметка: он затирается
  при завершении сессии и чистится при выходе с очисткой данных. localStorage-
  копия при включённом шифровании по-прежнему подавлена (SEC-56). Если
  threat-model ужесточается — вариант A (шифровать content/title тем же
  maybeEncrypt) описан в `docs/audit-cleanup-plan.md` §3.10.
- **Стрим + fallback списывают два слота** (#77). Остаточный случай после
  refund-on-disconnect — обрыв соединения посреди стрима: генерация на обеих
  попытках реально произошла. Вариант A (списывать после первого байта
  апстрима) отклонён — переносит биллинг в середину запроса и дробит атомарный
  claim cooldown+лимит; решение задокументировано в `useAIChat.ts`.
