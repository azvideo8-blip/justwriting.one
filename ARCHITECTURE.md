# Architecture Documentation

## Target Architecture: Feature-First

We are moving from a technical grouping (components/, hooks/, views/) to a domain-driven grouping (features/).

### Directory Structure

- `src/core/`: Singleton infrastructure (Firebase, i18n, shared utils).
- `src/features/`: Domain modules containing their own components, hooks, and logic.
  - `src/features/writing/`: Writing session logic and UI.
  - `src/features/archive/`: Archive and history management.
- `src/shared/`: Reusable, stateless UI components (Design System).
- `src/types/`: Global TypeScript definitions.

### Responsibility Boundaries

- **Shared**: Stateless UI components, design system elements. No business logic.
- **Features**: Domain-specific logic, state management, and UI.
- **Core**: Global infrastructure, configuration, and utilities.

### Data Flow (State Ownership)

- State should be owned by the feature that uses it.
- Global state (like user profile, settings) should be managed via Context or a global store in `src/core/`.
- Avoid prop drilling; use Context for cross-cutting concerns.
