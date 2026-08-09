-- 0005_ai_global_daily_tokens.sql
ALTER TABLE public.ai_global_daily ADD COLUMN IF NOT EXISTS tokens BIGINT NOT NULL DEFAULT 0;
