# Incident Runbook

## Severity Levels

| Level | Definition | Response Time |
|-------|-----------|---------------|
| P1 | Service down / data loss | 15 min |
| P2 | Major feature broken | 1 hour |
| P3 | Minor feature degraded | 4 hours |
| P4 | Cosmetic / nice-to-fix | Next sprint |

## Incident Response Checklist

1. **Acknowledge** — Confirm alert, assign responder
2. **Assess** — Determine severity (P1-P4)
3. **Communicate** — Post status in #incidents channel
4. **Mitigate** — Apply fix or rollback (see rollback-guide.md)
5. **Resolve** — Confirm fix is live, monitor for 30 min
6. **Postmortem** — Document within 48 hours

## Common Scenarios

### Firestore Unreachable
- Check [Firebase Status](https://status.firebase.google.com)
- App auto-switches to offline mode (IndexedDB)
- Users can continue writing locally
- Sync resumes when Firestore recovers

### AI Service Down
- Check Gemini API status
- Users see "AI unavailable" message
- Daily limits reset at midnight UTC
- No data loss — all content is local

### Encryption Key Lost
- User cannot decrypt existing encrypted content
- No recovery possible without password
- Non-encrypted content remains accessible
- Consider adding key recovery hints in future

### Sync Conflicts
- Conflict detection creates forked documents
- Users see "(Conflict)" in title
- Both versions preserved — no data loss
- User can manually merge

## Feature Flags

Feature flags are managed via `src/core/services/featureFlags.ts`.

### Available Flags
| Flag | Default | Purpose |
|------|---------|---------|
| `ai_enabled` | true | Disable all AI features |
| `sync_enabled` | true | Disable cloud sync |
| `encryption_enabled` | true | Disable encryption UI |
| `export_enabled` | true | Disable export features |
