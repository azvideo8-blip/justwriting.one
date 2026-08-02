# Supabase schema and RLS tests

## Running RLS tests locally

Requires Docker. Spins up a throwaway Postgres container, applies all
migrations, seeds test data, and runs negative RLS checks as Alice
attempting to access Bob's data.

```sh
docker run -d --name pg-rls-test -e POSTGRES_PASSWORD=test -p 5434:5432 postgres:16
sleep 3
docker exec -i pg-rls-test psql -U postgres < supabase/tests/_auth_setup.sql
docker exec -i pg-rls-test psql -U postgres < supabase/migrations/0001_schema.sql
docker exec -i pg-rls-test psql -U postgres < supabase/migrations/0002_rls.sql
docker exec -i pg-rls-test psql -U postgres < supabase/migrations/0003_local_store_records.sql
docker exec -i pg-rls-test psql -U postgres < supabase/tests/rls.test.sql
docker stop pg-rls-test && docker rm pg-rls-test
```

All 27 checks should pass (DO blocks exit silently on success).
Any failure raises `RAISE EXCEPTION` and psql exits non-zero.

## Migrations

- `0001_schema.sql` — tables ported from Firestore rules + localDb.ts
- `0002_rls.sql` — Row-Level Security policies
- `0003_local_store_records.sql` — verbatim browser-only store dump table
