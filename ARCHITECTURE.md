# Architecture Documentation

## Target Architecture: Feature-First

Domain-driven grouping (features/) ensures each domain is self-contained and testable.

### Directory Structure

- `src/app/`: Application-level setup, routing, and global providers.
- `src/core/`: Singleton infrastructure (Firebase, i18n, shared utils, shared services).
  - `src/core/services/`: Cross-cutting services used by multiple features (DocumentService, SessionService, StorageService, SyncService, LocalDocumentService, VersionService, DiffService, EncryptionService).
  - `src/core/crypto/`: Encryption primitives (AES-GCM, PBKDF2, key wrapping).
  - `src/core/firebase/`: Firebase client initialization, Firestore lazy-loader, auth.
  - `src/core/errors/`: Error handling, reporting, and logging.
  - `src/core/storage/`: IndexedDB (localDb) setup and schema.
- `src/features/`: Domain modules.
  - `src/features/admin/`: Admin dashboard and user management.
  - `src/features/ai/`: AI-related services and components (chat, edit, summarize, personas).
  - `src/features/archive/`: Archive and history management.
  - `src/features/auth/`: Authentication, login, and privacy modal.
  - `src/features/encryption/`: Encryption UI (password modal, setup hook).
  - `src/features/export/`: Export utilities (PDF, DOCX, MD, ZIP).
  - `src/features/navigation/`: App navigation (sidebar, bottom nav).
  - `src/features/profile/`: User profile, stats, and achievements.
  - `src/features/settings/`: User settings and preferences.
  - `src/features/writing/`: Writing session logic, editor, and UI.
    - `store/`: Zustand stores (useContentStore, useTimerStore, useSessionMetaStore).
    - `hooks/`: Session hooks (useBaseWritingSession, useCloudWritingSession, useGuestWritingSession).
    - `services/`: Feature-specific services (WritingDraftService, GuestDraftService, WritingSessionService).
    - `components/`: UI components (MobileWriteScreen, SessionEditor, AIPanel).
- `src/shared/`: Reusable, stateless UI components (Design System) and shared utilities.

### Responsibility Boundaries

- **Shared**: Stateless UI components, design system elements, pure utility functions. No business logic. No Firebase imports.
- **Features**: Domain-specific logic, state management, and UI. Features should NOT import from other features directly — use `core/services/` for shared service access.
- **Core**: Global infrastructure, configuration, shared services, and utilities. Core must NOT import from `features/`.
- **App**: Bootstrapping and global routing.

### Data Model

#### Local-First Architecture (IndexedDB)
All data is stored locally first in IndexedDB via the `idb` library:
- `documents` store: Local document metadata
- `versions` store: Document version content
- `profile` store: Aggregated user stats
- `syncQueue` store: Pending sync operations
- `drafts` store: Active writing drafts

#### Cloud (Firestore)
- `users/{userId}`: User profiles with encryption metadata
- `users/{userId}/documents/{documentId}`: Cloud document metadata
- `users/{userId}/documents/{documentId}/versions/{versionId}`: Document versions
- `sessions/{sessionId}`: Legacy sessions (being migrated)
- `drafts/{userId}`: Cloud drafts
- `aiDailyLimit/{uid}`: AI daily usage counters (admin SDK only)
- `aiCooldown/{uid}`: AI rate limiting (admin SDK only)
- `aiUsage/{uid}/daily/{date}`: AI usage statistics

#### Sync Flow
1. Data writes go to IndexedDB first (local-first)
2. If Firestore is connected, `syncVersionToCloud` pushes versions to cloud
3. If offline, writes go to `syncQueue` and are drained on reconnection
4. Conflict resolution: if cloud version >= local version, a forked document is created

### Encryption

AES-256-GCM encryption with PBKDF2 key derivation:
1. User password → PBKDF2 (300K iterations) → Master Key (AES-KW)
2. Random Data Key (AES-256-GCM) generated
3. Data Key wrapped with Master Key → stored in Firestore
4. Content encrypted with Data Key
5. Verification plaintext encrypted for key validation
6. Session key held in memory (useEncryptionStore) while vault is unlocked

### Service Layer Pattern

- **UI Components / Pages**: Rendering and user input only. No direct database access.
- **Services**: Encapsulate domain logic, data fetching, and mutations. Makes business logic testable without React.
- **StorageService**: Orchestrates local ↔ cloud sync, encryption, and version management.

### State Management

- **Zustand** for high-frequency, cross-component state (timers, content, encryption keys).
- **React Context** for provider-scoped, low-frequency state (auth, settings, login modal).
- Features should NOT access other features' stores directly.

### Cloud Functions

| Function | Trigger | Auth | Purpose |
|----------|---------|------|---------|
| `chatWithAI` | HTTPS Call | Firebase Auth | AI chat with persona system |
| `editWithAI` | HTTPS Call | Firebase Auth | AI text editing actions |
| `summarizeDocument` | HTTPS Call | Firebase Auth | AI document summarization |
| `validateCustomPrompt` | HTTPS Call | Firebase Auth | Validate custom AI persona prompt |
| `getAILimit` | HTTPS Call | Firebase Auth | Get user's AI usage limit |
| `getAIUsageStats` | HTTPS Call | Firebase Auth (Admin) | Admin AI usage statistics |
| `setUserRole` | HTTPS Call | Firebase Auth (Admin) | Set user role |

> **App Check status:** Client-side App Check is wired up, but all callable functions
> and the Vercel `/api/chat` endpoint currently run with enforcement **off**
> (`enforceAppCheck: false`). Endpoints are protected by Firebase Auth (verified ID
> token) + per-user/global rate limits only. Enabling enforcement is tracked separately
> (see hardening sub-task below).

All AI functions enforce: daily limit (5-50 requests/day), cooldown (10s between calls), prompt injection guard.

### Vercel API

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/chat` | POST | Bearer token (Firebase ID) | Streaming AI chat (Vercel Edge) |

See [AI Endpoints API Reference](api/ai-endpoints.md) for full request/response schemas and error codes.
