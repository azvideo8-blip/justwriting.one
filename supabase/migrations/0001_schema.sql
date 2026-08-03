-- 0001_schema.sql — Supabase schema ported from Firestore rules and localDb.ts
-- Key for documents: uuid (C1).  Cipher-text columns are `text`; the client
-- sends opaque blobs, the server never decrypts.

-- ============================================================
-- users  (Firestore: /users/{userId})
-- Allowed fields derived from isValidUserCreate / isValidUserUpdate
-- ============================================================
create table if not exists public.users (
  uid         uuid primary key,                          -- == auth.uid
  email       text not null,
  nickname    text check (nickname is null or length(nickname) <= 100),
  encryption_salt     text,
  encrypted_data_key  text,
  encryption_meta     jsonb,
  labels              jsonb default '[]'::jsonb,
  earned_achievements jsonb default '[]'::jsonb,
  total_word_count    integer default 0,
  sessions_count      integer default 0,
  streak_days         integer default 0,
  total_duration      integer default 0,
  avg_wpm             real,
  avg_session_words   real,
  privacy_accepted_at timestamptz,
  privacy_version     smallint,
  ai_portrait         text check (ai_portrait is null or length(ai_portrait) <= 100000),
  _encrypted          boolean default false,
  role                text default 'user',               -- client CANNOT write this
  created_at          timestamptz default now()
);

-- ============================================================
-- documents  (Firestore: /users/{userId}/documents/{documentId})
-- Key: uuid (C1 canonical identifier).  `id` is a serial for FK convenience.
-- ============================================================
create table if not exists public.documents (
  id                bigint generated always as identity primary key,
  uuid              text unique not null,                 -- C1 canonical id
  user_id           uuid not null references public.users(uid) on delete cascade,
  title             text not null default '' check (length(title) <= 200),
  current_version   integer not null default 0 check (current_version >= 0),
  total_words       integer not null default 0 check (total_words >= 0),
  total_duration    integer not null default 0 check (total_duration >= 0),
  sessions_count    integer not null default 0 check (sessions_count >= 0),
  first_session_at  timestamptz,
  last_session_at   timestamptz,
  is_public         boolean,
  tags              jsonb default '[]'::jsonb,
  label_id          text,
  mood              text check (mood is null or length(mood) <= 50),
  created_at        timestamptz default now()
);

create index if not exists idx_documents_user on public.documents(user_id);

-- ============================================================
-- versions  (Firestore: /users/{userId}/documents/{documentId}/versions/{versionId})
-- ============================================================
create table if not exists public.versions (
  id                bigint generated always as identity primary key,
  document_uuid     text not null references public.documents(uuid) on delete cascade,
  user_id           uuid not null references public.users(uid) on delete cascade,
  version           integer not null check (version >= 0),
  content           text not null check (length(content) <= 700000),
  word_count        integer not null default 0 check (word_count >= 0),
  words_added       integer not null default 0,
  chars_added       integer not null default 0,
  duration          integer not null default 0,
  wpm               real not null default 0,
  goal_words        integer,
  goal_time         integer,
  goal_reached      boolean default false,
  saved_at          timestamptz,
  session_started_at timestamptz,
  mood              text check (mood is null or length(mood) <= 50),
  _encrypted        boolean default false,
  created_at        timestamptz default now()
);

create index if not exists idx_versions_doc on public.versions(document_uuid);
create index if not exists idx_versions_user on public.versions(user_id);
create unique index if not exists idx_versions_doc_ver on public.versions(document_uuid, version);

-- ============================================================
-- drafts  (Firestore: /drafts/{userId})
-- Audit finding: read ONLY by owner (no admin read).
-- ============================================================
create table if not exists public.drafts (
  user_id              uuid primary key references public.users(uid) on delete cascade,
  title                text check (title is null or length(title) <= 200),
  content              text not null check (length(content) <= 100000),
  seconds              real,
  wpm                  real,
  word_count           real,
  initial_word_count   real,
  active_session_id    text,
  session_start_time   real,
  accumulated_duration real,
  total_pause_seconds  real,
  saved_document_id    text,
  tags                 jsonb,
  label_id             text,
  pinned_thoughts      jsonb,                           -- list ≤20 or ciphertext string ≤50000
  _encrypted           boolean default false,
  updated_at           timestamptz not null default now()
);

-- ============================================================
-- ai_summaries  (Firestore: /users/{userId}/summaries/{documentId})
-- ============================================================
create table if not exists public.ai_summaries (
  document_id      text not null,                       -- references document uuid
  user_id          uuid not null references public.users(uid) on delete cascade,
  summary          text check (summary is null or length(summary) <= 20000),
  tone             text check (tone is null or length(tone) <= 5000),
  frequent_words   jsonb,
  author_phrases   jsonb,
  insights         jsonb,
  quotable_sentence text check (quotable_sentence is null or length(quotable_sentence) <= 5000),
  themes           jsonb,
  extracted_facts  jsonb,
  mentioned_people jsonb,
  processed_at     bigint,
  commitments      jsonb,
  valence          real,
  arousal          real,
  echo             text check (echo is null or length(echo) <= 5000),
  content_hash     text check (content_hash is null or length(content_hash) <= 500),
  event_date       text check (event_date is null or length(event_date) <= 500),
  prompt_version   integer,
  _encrypted       boolean default false,
  created_at       timestamptz default now(),
  primary key (user_id, document_id)
);

-- ============================================================
-- ai_embeddings  (Firestore: /users/{userId}/embeddings/{documentId})
-- ============================================================
create table if not exists public.ai_embeddings (
  document_id      text not null,
  user_id          uuid not null references public.users(uid) on delete cascade,
  vectors_json     text check (vectors_json is null or length(vectors_json) <= 1000000),
  vector_json      text check (vector_json is null or length(vector_json) <= 1000000),
  chunk_texts_json text check (chunk_texts_json is null or length(chunk_texts_json) <= 1000000),
  model            text check (model is null or length(model) <= 1000),
  dim              integer check (dim is null or (dim >= 0 and dim <= 8192)),
  content_hash     text check (content_hash is null or length(content_hash) <= 1000),
  processed_at     bigint,
  schema_v         integer,
  _encrypted       boolean default false,
  created_at       timestamptz default now(),
  primary key (user_id, document_id)
);

-- ============================================================
-- ai_daily_limit  (Firestore: /aiDailyLimit/{uid}) — admin SDK only
-- ============================================================
create table if not exists public.ai_daily_limit (
  uid       uuid primary key references public.users(uid) on delete cascade,
  data      jsonb,
  updated_at timestamptz default now()
);

-- ============================================================
-- ai_cooldown  (Firestore: /aiCooldown/{uid}) — admin SDK only
-- ============================================================
create table if not exists public.ai_cooldown (
  uid       uuid primary key references public.users(uid) on delete cascade,
  data      jsonb,
  updated_at timestamptz default now()
);

-- ============================================================
-- ai_usage  (Firestore: /aiUsage/{uid}/daily/{date}) — admin writes, user reads own
-- ============================================================
create table if not exists public.ai_usage (
  uid   uuid not null references public.users(uid) on delete cascade,
  date  text not null,
  data  jsonb,
  primary key (uid, date)
);

-- ============================================================
-- ai_global_daily  (Firestore: /aiGlobalDaily/{date}) — admin SDK only
-- ============================================================
create table if not exists public.ai_global_daily (
  date  text primary key,
  data  jsonb
);

-- ============================================================
-- anonymized_telemetry  (Firestore: /anonymizedTelemetry/{id}) — admin read, no client write
-- ============================================================
create table if not exists public.anonymized_telemetry (
  id         text primary key,
  data       jsonb,
  created_at timestamptz default now()
);

-- ============================================================
-- connection_test  (Firestore: /_connection_test_/ping) — read-only for auth users
-- ============================================================
create table if not exists public.connection_test (
  id text primary key default 'ping'
);

-- ============================================================
-- Triggers
-- ============================================================
create or replace function public.protect_user_columns()
returns trigger as $$
begin
  if new.role is distinct from old.role then
    raise exception 'role is server-controlled';
  end if;
  if new.uid is distinct from old.uid then
    raise exception 'uid is immutable';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger users_protect_columns
  before update on public.users
  for each row execute function public.protect_user_columns();
