# Security Documentation

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
- **Sentry:** `maskAllText: true`, `blockAllMedia: true`. Request data deleted in `beforeSend`. User identified by UID only (not email). Session replays at 10% sample rate (100% for errors).
- **Langfuse:** AI request observability (persona, action, tokens, model). No user content stored — only metadata.

## Shared Injection Patterns

Injection patterns are maintained in a single source: `src/shared/ai/injectionPatterns.ts`. Both `api/chat.ts` (Vercel Edge) and `functions/src/shared/aiUtils.ts` (Cloud Functions) import from this file. A parity test exists at `src/features/ai/shared/__tests__/injectionPatterns.test.ts`.

> **Note:** Cloud Functions maintain a mirror copy with a "keep in sync" comment due to separate `rootDir`/`tsconfig.json`. After Supabase migration, both sides will import from a single shared package.
