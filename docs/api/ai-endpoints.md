# AI Endpoints — API Reference

## Vercel Streaming Endpoint

### `POST /api/chat`

Streaming AI chat with persona system, served from Vercel Edge.

**Authentication:** `Authorization: Bearer <Firebase ID token>`  
**App Check:** `x-firebase-appcheck: <token>` — required when `APP_CHECK_ENFORCE=true` (enabled in production).

**Request body (JSON):**

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `personaId` | `enum` | `group_psychology`, `cbt`, `coach`, `editor`, `journalist`, `custom` | Persona to use |
| `customSystemPrompt` | `string?` | max 500 chars | Required when `personaId` is `custom` |
| `messages` | `array` | max 100 items; total content ≤ 200K chars | Chat history |
| `messages[].role` | `enum` | `user`, `assistant` | Message author |
| `messages[].content` | `string` | max 10,000 chars each | Message text |
| `documentContent` | `string?` | max 50,000 chars | Attached document text |
| `documentMood` | `string?` | max 50 chars | Document mood label |
| `userPortrait` | `string?` | max 100,000 chars | AI-generated user profile |

**Response:** Streamed `text/plain` (token-by-token).

**Error codes:**

| Status | Code | Meaning |
|--------|------|---------|
| 401 | `Unauthorized` | Missing or invalid ID token |
| 401 | `Unauthorized: App Check token required` | `APP_CHECK_ENFORCE=true` but `x-firebase-appcheck` header missing |
| 401 | `Unauthorized: Invalid App Check token` | App Check token failed verification |
| 400 | `Bad Request` | Schema validation failed or injection pattern detected |
| 405 | — | Non-POST method |
| 429 | `DAILY_LIMIT` | Per-user daily request cap reached |
| 429 | `GLOBAL_LIMIT` | Project-wide free-tier daily cap reached |

---

## Firebase Callable Functions

All callables use Firebase Auth (verified ID token) **and Firebase App Check** (`enforceAppCheck: true`). Requests without a valid App Check token are automatically rejected by the Firebase Functions runtime before handler code runs.

### `chatWithAI`

AI chat with persona system (non-streaming).

**Request data:** Same schema as `/api/chat` above.

**Response:** `{ result: string }` — the assistant's reply.

**Error codes:** `unauthenticated`, `resource-exhausted` (daily limit / rate limit / global limit), `invalid-argument` (schema / injection), `internal` (Gemini failure).

### `editWithAI`

AI-powered text editing actions.

**Request data:**

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `content` | `string` | 1–50,000 chars | Text to edit |
| `action` | `enum` | `shorten`, `accents`, `ideas`, `summarize`, `tags`, `mood`, `continue` | Edit action |
| `history` | `array?` | max 10 items | Previous edit turns for context |

**Response:** `{ result: string }`

**Error codes:** Same as `chatWithAI`.

### `summarizeDocument`

AI document summarization (returns structured JSON).

**Request data:**

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `content` | `string` | 50–50,000 chars | Document text |
| `mood` | `string?` | max 50 chars | Mood hint |

**Response:**

```json
{
  "tone": "string",
  "frequentWords": ["string"],
  "insights": ["string"],
  "themes": ["string"],
  "extractedFacts": ["string"]
}
```

**Error codes:** Same as `chatWithAI`.

### `validateCustomPrompt`

Validate a custom AI persona prompt for safety and relevance.

**Request data:**

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `prompt` | `string` | 10–500 chars | Custom prompt to validate |

**Response:** `{ valid: boolean, reason?: string }`

**Error codes:** `unauthenticated`, `resource-exhausted`, `invalid-argument`.

### `getAILimit`

Get the current user's AI usage limit and how many requests they've used today.

**Request data:** `{}` (empty)

**Response:**

```json
{
  "used": 3,
  "limit": 5,
  "date": "2026-05-31"
}
```

**Error codes:** `unauthenticated`.

### `getAIUsageStats` (Admin only)

Admin dashboard statistics for AI usage across all users.

**Request data:**

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `date` | `string` | `YYYY-MM-DD` format | Date to query |

**Response:**

```json
{
  "stats": [{ "uid": "string", "requests": 0, "promptTokens": 0, "completionTokens": 0 }],
  "totals": { "requests": 0, "promptTokens": 0, "completionTokens": 0 },
  "limits": { "requestsPerDay": 10000, "tokensPerDay": 25000000, "requestsPerMinute": 1000, "tokensPerMinute": 1000000, "perUserDaily": 5 }
}
```

**Error codes:** `unauthenticated`, `permission-denied` (non-admin), `invalid-argument`.

### `setUserRole` (Admin only)

Set a user's role (`user` or `admin`).

### `resetUserLimit` (Admin only)

Reset a user's daily AI request counter. Blocked if project-wide daily usage exceeds safety budget (500 requests / $5 USD).

**Request data:**

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `targetUid` | `string` | 1–128 chars | UID of the user whose limit to reset |

**Response:** `{ success: true, totalRequests: number, totalCost: number }`

**Error codes:** `unauthenticated`, `permission-denied`, `invalid-argument`, `resource-exhausted` (safety budget exceeded).

---

## Rate Limits

| Limit | Value | Scope | Config |
|-------|-------|-------|--------|
| Per-user daily | 5 requests (default) | Per UID | `AI_DAILY_LIMIT` env |
| Cooldown | 10 seconds | Per UID | Hardcoded |
| Project-wide daily requests | 10,000 (default) | All users | `AI_TIER_RPD` env |
| Project-wide daily tokens | 25M (default) | All users | `AI_TIER_TPD` env |
| Project-wide RPM | 1,000 (default) | All users | `AI_TIER_RPM` env |
| Project-wide TPM | 1M (default) | All users | `AI_TIER_TPM` env |
