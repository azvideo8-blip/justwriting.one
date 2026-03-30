# Architecture Documentation

## Target Architecture: Feature-First

We have moved from a technical grouping (components/, hooks/, views/) to a domain-driven grouping (features/). This ensures that each domain is self-contained and easily testable.

### Directory Structure

- `src/app/`: Application-level setup, routing, and global providers (e.g., `AppRouter.tsx`, `AppProviders.tsx`).
- `src/core/`: Singleton infrastructure (Firebase, i18n, shared utils).
- `src/features/`: Domain modules containing their own pages, components, hooks, and services.
  - `src/features/admin/`: Admin dashboard and user management.
  - `src/features/ai/`: AI-related services and components.
  - `src/features/archive/`: Archive and history management.
  - `src/features/auth/`: Authentication and login logic.
  - `src/features/feed/`: Public feed and shared sessions.
  - `src/features/navigation/`: App navigation components.
  - `src/features/profile/`: User profile, stats, and achievements.
  - `src/features/settings/`: User settings and preferences.
  - `src/features/writing/`: Writing session logic, editor, and UI.
- `src/shared/`: Reusable, stateless UI components (Design System) and shared utilities.

### Responsibility Boundaries

- **Shared**: Stateless UI components, design system elements. No business logic.
- **Features**: Domain-specific logic, state management, and UI.
- **Core**: Global infrastructure, configuration, and utilities.
- **App**: Bootstrapping and global routing.

### Service Layer Pattern

In our feature-first architecture, we employ a **Service Layer** pattern to separate UI components from business logic and data access (e.g., Firebase).
- **UI Components / Pages**: Responsible only for rendering the interface and capturing user input. They do not interact directly with the database.
- **Services (e.g., `SessionService.ts`, `AuthService.ts`)**: Encapsulate domain logic, data fetching, and database mutations. The UI calls these services to perform actions. This makes the business logic highly reusable and testable without mounting React components.

### State Orchestration in `useWritingSession`

The `useWritingSession` hook acts as the central orchestrator for the writing experience. It manages:
- **Local State**: Current text, word count, and active session metrics.
- **Timers**: Handling the writing timer and tracking elapsed time.
- **Service Integration**: Communicating with `SessionService` to save sessions to the database once completed or auto-saving drafts.
- **AI Integration**: Coordinating with `AiService` for features like "Stream of Consciousness" or text editing.
This hook abstracts the complex state transitions of a writing session away from the `WritingPage` component, keeping the UI clean and focused on rendering.
