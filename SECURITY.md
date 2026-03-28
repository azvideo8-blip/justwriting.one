# Security Documentation

## Firestore Security Rules

Our Firestore rules are designed with the principle of "Least Privilege".

### Key Principles:
- **Role-Based Access Control (RBAC):** Admin access is strictly controlled via the `role` field in the user's Firestore document. No hardcoded emails are used.
- **Strict User Isolation:** Users can only read, update, or delete their own sessions.
- **Data Validation:** All input fields (content, title, tags) are validated for type and size to prevent malicious payloads and DoS attacks.
- **Default Deny:** All access is denied by default unless explicitly allowed.

## Cloud Functions Security

The `editWithAI` function is secured to prevent abuse:

- **Authentication:** The function checks for a valid `request.auth` object before proceeding.
- **Payload Validation:** The `content` field is validated to be a string and is limited to 50,000 characters.
- **Action Validation:** The `action` field is checked against a predefined list of allowed actions (`shorten`, `accents`, `ideas`).
- **Error Handling:** AI API calls are wrapped in `try-catch` blocks to prevent internal errors from leaking to the client.
