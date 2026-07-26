# AG-ADMIN-claim — the UI offers admin screens the rules will refuse

**Priority:** P2 · user-visible: "Missing or insufficient permissions" with no explanation · Scope: Small

## The problem

Two different sources decide "is this user an admin":

| Decides | Source |
|---|---|
| **The UI** — `useDiagnosticsData.ts:210` | `profile?.role === 'admin'` — the Firestore **document field** |
| **Firestore rules** — `firestore.rules:29` | `request.auth.token.role == 'admin'` — the **custom claim** in the ID token |

So the app renders the admin view because the field says admin, then `AdminUserService.getUsers()` queries the `users` collection and the rules deny it. The user gets a raw "Missing or insufficient permissions" with no idea what to do.

`setUserRole` writes **both** the field and the claim, so the usual cause is not a missing claim but a **stale ID token**: custom claims are baked into the token at sign-in and do not refresh on their own. Signing out and back in fixes it — which nobody can guess from the error.

Note this is not a security hole: the rules are the authority and they are correct. It is the UI promising something the backend will refuse.

## Tasks

1. **Decide admin from the same source the rules use.** Read the claim from the ID token (`getIdTokenResult()`), not the Firestore field, when deciding whether to show admin surfaces. The field stays as the stored source of truth that `setUserRole` writes; the claim is what actually grants access.

2. **Try a token refresh before failing.** If the field says admin but the claim does not, call `getIdToken(true)` once and re-check — that is exactly the stale-token case and it resolves silently without the user knowing anything happened.

3. **If it still disagrees, say so in words.** Replace the raw permission error on admin screens with something actionable: the account is marked admin but the session token predates it, sign out and back in. Never leave "Missing or insufficient permissions" as the whole message.

4. **Do not loosen the rules** to match the UI. The claim is the right gate; the UI is what should follow it.

## Acceptance

- [ ] An account with the field but a stale token gets a silent token refresh and the admin screens work.
- [ ] An account with neither field nor claim sees no admin surfaces at all (not surfaces that error on click).
- [ ] An account whose claim genuinely is not set sees an explanatory message, not a raw permission error.
- [ ] `firestore.rules` unchanged.
- [ ] `tsc` 0 (root + functions), **full** vitest suite, **full** `npm run lint` with `NODE_OPTIONS=--max-old-space-size=8192`.

## Context

Flagged earlier as SEC-10 and downgraded to "latent — not a live hole". It is no longer latent: it is now producing errors in normal use. The security judgement was right; the usability consequence was underweighted.
