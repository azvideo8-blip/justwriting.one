# Security Documentation

## Role Model
The application uses a role-based access control (RBAC) system defined in Firestore:
- `user`: Standard user, can manage their own sessions and profile.
- `admin`: Elevated privileges, can view all sessions and manage users.

Roles are stored in the `users` collection within the `role` field. The `AuthService` acts as the single source of truth for role-checking logic on the client side, while Firestore rules and Cloud Functions enforce these roles on the backend.

## Data Isolation Assumptions
- **User Data**: Users can only access their own profile and sessions.
- **Session Data**: Sessions are private by default, unless explicitly set to `isPublic: true`.
- **Admin Access**: Admins have read access to all sessions and user profiles.

## Firestore Security Rules

Our Firestore rules are designed with the principle of "Least Privilege". Security is not just a "UI trick" (hiding buttons); it is strictly enforced at the database level.

### Key Principles:
- **Role-Based Access Control (RBAC):** Admin access is strictly controlled via the `role` field in the user's Firestore document. No hardcoded emails are used.
- **Strict User Isolation:** Users can only read, update, or delete their own sessions. Update and delete operations strictly require `request.auth.uid == resource.data.userId`.
- **Public Feed Logic:** Any "Public Feed" logic only allows read access for `isPublic == true` and explicitly prevents write access by non-owners.
- **Data Validation:** All input fields (content, title, tags) are validated for type and size to prevent malicious payloads and DoS attacks.
- **Default Deny:** All access is denied by default unless explicitly allowed.

## Cloud Functions Security

The `editWithAI` function is secured to prevent abuse:

- **Authentication:** The function explicitly checks for a valid `request.auth` object before processing any data.
- **Payload Validation:** The `content` field is validated to be a string and is limited to 50,000 characters.
- **Action Validation:** The `action` field is checked against a predefined list of allowed actions (`shorten`, `accents`, `ideas`).
- **Error Handling:** AI API calls are wrapped in `try-catch` blocks to prevent internal errors from leaking to the client.
