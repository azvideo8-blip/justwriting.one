-- supabase/tests/postulates_canary.sql
-- TB-03: Нарочно открытая строка в documents с незарезервированным uid и кириллическим title.
-- Обход базы данных в scripts/postulates.mjs обязан на ней падать — это канарейка, что обход жив.

INSERT INTO auth.users (id, email)
VALUES ('c0000000-0000-0000-0000-000000000001', 'canary@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.documents (uuid, user_id, title, _encrypted)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  'Канарейка открытого текста',
  false
);
