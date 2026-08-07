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

## Checking a real deployment

`rls.test.sql` above runs against bare Postgres with a stand-in `auth` schema, so
it proves the policies and nothing else. It cannot see whether a JWT actually
reaches those policies, or whether role grants reject the request before RLS is
ever consulted — a stack can fail both ways with perfect policies.

`tests/e2e-rls.sh` covers that gap. It runs **on the server**, mints real
`authenticated` JWTs with the deployment's own `JWT_SECRET`, and drives the full
Kong → PostgREST → RLS path: Alice reads her own row, fails to read Bob's by
listing and by direct lookup, an anonymous caller gets nothing, and a forged
insert under Bob's `user_id` is refused. Test rows are removed at the end.

```sh
# on the VPS, from anywhere
bash /path/to/e2e-rls.sh          # expects /opt/justwriting/supabase
```

Exits non-zero if any check fails. Run it after every migration and after any
change to Kong, PostgREST or the JWT settings.

## Migrations

- `0001_schema.sql` — tables ported from Firestore rules + localDb.ts
- `0002_rls.sql` — Row-Level Security policies
- `0003_local_store_records.sql` — verbatim browser-only store dump table

Applied to the self-hosted instance with, from `/opt/justwriting/supabase`:

```sh
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < 0001_schema.sql
```

`_auth_setup.sql` is for the throwaway container only — real Supabase brings its
own `auth` schema, and applying the stand-in over it would be wrong.
