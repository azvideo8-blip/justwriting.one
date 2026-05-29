# Rollback Guide

## Vercel Frontend Rollback

1. Go to Vercel Dashboard → Deployments
2. Find the last known good deployment
3. Click "..." menu → "Promote to Production"
4. Verify the promotion took effect

### CLI Alternative
```bash
npx vercel rollback
```

## Firebase Functions Rollback

1. List function versions:
```bash
firebase functions:log --only chatWithAI
```
2. Redeploy previous version:
```bash
git checkout <previous-commit>
cd functions && npm run build
firebase deploy --only functions
git checkout main
```

## Firestore Data Recovery

If a deploy corrupts data:
1. Use Firestore console "Point-in-time Recovery" (if enabled)
2. Export from backup:
```bash
gcloud firestore export gs://<bucket>/backups/recovery-$(date +%Y%m%d)
```

## Emergency Contacts
- Check incident runbook for on-call rotation
