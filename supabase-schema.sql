-- ============================================================
--  🎧 VOTIFY — Supabase Database Schema
-- ============================================================
--  Run this ENTIRE script in your Supabase SQL Editor
--  (Supabase Dashboard → SQL Editor → New Query → Paste → Run)
-- ============================================================

-- 1. Create the queue table
CREATE TABLE queue (
  id              UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  youtube_id      TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  thumbnail_url   TEXT,
  votes           INTEGER     DEFAULT 1,
  played          BOOLEAN     DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- 2. Enable Realtime on the queue table
ALTER PUBLICATION supabase_realtime ADD TABLE queue;

-- 3. Atomic upvote function (prevents race conditions on concurrent votes)
CREATE OR REPLACE FUNCTION increment_vote(row_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE queue SET votes = votes + 1 WHERE id = row_id;
END;
$$ LANGUAGE plpgsql;

-- 4. (Optional) Disable Row Level Security for hackathon use
--    Remove these lines if you want to add proper RLS policies
ALTER TABLE queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read"
  ON queue FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert"
  ON queue FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public update"
  ON queue FOR UPDATE
  USING (true)
  WITH CHECK (true);
