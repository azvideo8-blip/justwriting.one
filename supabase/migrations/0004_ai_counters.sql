-- Create table for global daily AI call counter
CREATE TABLE IF NOT EXISTS ai_global_daily (
    day DATE PRIMARY KEY,
    call_count BIGINT NOT NULL DEFAULT 0
);

-- Create table for per-user daily AI call limits
CREATE TABLE IF NOT EXISTS ai_daily_limit (
    uid TEXT NOT NULL,
    day DATE NOT NULL,
    call_count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (uid, day)
);

-- Optional index for fast lookup per uid
CREATE INDEX IF NOT EXISTS idx_ai_daily_limit_uid_day ON ai_daily_limit(uid, day);
