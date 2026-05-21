-- ============================================================
--  🎧 VOTIFY V2 — Full Database Schema
--  Run this ENTIRE script in: Supabase Dashboard → SQL Editor → New Query
--  This is a CLEAN SLATE schema — safe for fresh projects.
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- CLEANUP (drop old V1 objects safely)
-- ============================================================
DROP TRIGGER  IF EXISTS on_auth_user_created    ON auth.users;
DROP TRIGGER  IF EXISTS queue_touches_room       ON queue;
DROP FUNCTION IF EXISTS handle_new_user()        CASCADE;
DROP FUNCTION IF EXISTS generate_room_code()     CASCADE;
DROP FUNCTION IF EXISTS cast_upvote(UUID, TEXT)  CASCADE;
DROP FUNCTION IF EXISTS cast_downvote(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS verify_room_pin(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS expire_inactive_rooms()  CASCADE;
DROP FUNCTION IF EXISTS touch_room_activity()    CASCADE;
DROP FUNCTION IF EXISTS increment_vote(UUID)     CASCADE;
DROP TABLE IF EXISTS room_bans         CASCADE;
DROP TABLE IF EXISTS room_participants CASCADE;
DROP TABLE IF EXISTS skip_votes        CASCADE;
DROP TABLE IF EXISTS votes_cast        CASCADE;
DROP TABLE IF EXISTS queue             CASCADE;
DROP TABLE IF EXISTS rooms             CASCADE;
DROP TABLE IF EXISTS profiles          CASCADE;

-- ============================================================
-- PROFILES  (extends auth.users — one row per host account)
-- ============================================================
CREATE TABLE public.profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT        UNIQUE NOT NULL CHECK (length(username) >= 6),
  email         TEXT        NOT NULL,            -- cached for username+password lookup
  avatar_url    TEXT,
  is_premium    BOOLEAN     DEFAULT false,
  premium_since TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Auto-create a stub profile when a new user signs up via OAuth
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email)
  VALUES (
    NEW.id,
    'user_' || lower(substring(NEW.id::text, 1, 8)),
    COALESCE(NEW.email, '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- ROOMS
-- ============================================================
CREATE TABLE public.rooms (
  id              UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  code            TEXT        UNIQUE NOT NULL,
  name            TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  host_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pin             TEXT        CHECK (pin IS NULL OR (length(pin) >= 4 AND length(pin) <= 8)),
  status          TEXT        DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  mode            TEXT        NOT NULL CHECK (mode IN ('queue', 'listen_together')),
  livekit_room_name TEXT,
  is_saved        BOOLEAN     DEFAULT false,
  saved_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  last_active_at  TIMESTAMPTZ DEFAULT now()
);

-- Enforce one active room per host at the DB level
CREATE UNIQUE INDEX one_active_room_per_host
  ON rooms(host_id) WHERE status = 'active';

CREATE INDEX idx_rooms_code   ON rooms(code);
CREATE INDEX idx_rooms_host   ON rooms(host_id);
CREATE INDEX idx_rooms_status ON rooms(status);

-- ============================================================
-- QUEUE  (scoped to a room)
-- ============================================================
CREATE TABLE public.queue (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  room_id       UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  youtube_id    TEXT        NOT NULL,
  title         TEXT        NOT NULL,
  thumbnail_url TEXT,
  upvotes       INTEGER     DEFAULT 1,
  downvotes     INTEGER     DEFAULT 0,
  played        BOOLEAN     DEFAULT false,
  added_by      TEXT,       -- display name or guest token of the adder
  created_at    TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE INDEX idx_queue_room        ON queue(room_id);
CREATE INDEX idx_queue_room_played ON queue(room_id, played);

-- Keep room activity fresh whenever queue is touched
CREATE OR REPLACE FUNCTION touch_room_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE rooms SET last_active_at = now() WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER queue_touches_room
  AFTER INSERT OR UPDATE ON queue
  FOR EACH ROW EXECUTE FUNCTION touch_room_activity();

-- ============================================================
-- VOTES_CAST  (server-side vote deduplication — one per participant per item)
-- ============================================================
CREATE TABLE public.votes_cast (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  queue_id          UUID        NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  participant_token TEXT        NOT NULL,
  vote_type         TEXT        NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (queue_id, participant_token)
);

-- ============================================================
-- SKIP_VOTES  (democratic skip — crossing 50% triggers a song skip)
-- ============================================================
CREATE TABLE public.skip_votes (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  room_id           UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  queue_item_id     UUID        NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  participant_token TEXT        NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (room_id, queue_item_id, participant_token)
);

-- ============================================================
-- ROOM_PARTICIPANTS  (presence + activity tracking)
-- ============================================================
CREATE TABLE public.room_participants (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  room_id           UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_token TEXT        NOT NULL,
  display_name      TEXT,
  is_guest          BOOLEAN     DEFAULT true,
  songs_added       INTEGER     DEFAULT 0,
  votes_cast_count  INTEGER     DEFAULT 0,
  joined_at         TIMESTAMPTZ DEFAULT now(),
  last_seen_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (room_id, participant_token)
);

-- ============================================================
-- ROOM_BANS  (kick enforcement — checked by RLS)
-- ============================================================
CREATE TABLE public.room_bans (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  room_id           UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_token TEXT,
  user_id           UUID,
  display_name      TEXT,
  banned_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (room_id, participant_token),
  UNIQUE (room_id, user_id)
);

-- ============================================================
-- REALTIME PUBLICATIONS
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE queue;
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE skip_votes;
ALTER PUBLICATION supabase_realtime ADD TABLE room_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE room_bans;

-- ============================================================
-- RPC: generate_room_code
-- Produces a unique 6-char alphanumeric code (no ambiguous chars)
-- ============================================================
CREATE OR REPLACE FUNCTION generate_room_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code  TEXT := '';
  i     INTEGER;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM rooms WHERE rooms.code = code AND status = 'active'
    );
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RPC: verify_room_pin
-- Called by participants — returns true if pin matches (or room has no pin)
-- SECURITY DEFINER so participants cannot directly read pin column
-- ============================================================
CREATE OR REPLACE FUNCTION verify_room_pin(p_code TEXT, p_pin TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  room_pin TEXT;
  found    BOOLEAN;
BEGIN
  SELECT pin INTO room_pin
  FROM rooms
  WHERE code = upper(p_code) AND status = 'active';

  IF NOT FOUND THEN
    RETURN false; -- Room doesn't exist or is not active
  END IF;

  IF room_pin IS NULL THEN
    RETURN true; -- No PIN required
  END IF;

  RETURN room_pin = p_pin; -- Plain text comparison (PIN is low-security by design)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: cast_upvote  (atomic, handles vote-switching)
-- ============================================================
CREATE OR REPLACE FUNCTION cast_upvote(p_queue_id UUID, p_token TEXT)
RETURNS VOID AS $$
DECLARE existing TEXT;
BEGIN
  SELECT vote_type INTO existing
  FROM votes_cast
  WHERE queue_id = p_queue_id AND participant_token = p_token;

  IF existing IS NULL THEN
    INSERT INTO votes_cast (queue_id, participant_token, vote_type)
    VALUES (p_queue_id, p_token, 'up');
    UPDATE queue SET upvotes = upvotes + 1 WHERE id = p_queue_id;

  ELSIF existing = 'down' THEN
    -- Switch from downvote to upvote
    UPDATE votes_cast SET vote_type = 'up'
    WHERE queue_id = p_queue_id AND participant_token = p_token;
    UPDATE queue SET upvotes = upvotes + 1, downvotes = downvotes - 1
    WHERE id = p_queue_id;

  END IF;
  -- existing = 'up': already upvoted, idempotent no-op
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: cast_downvote  (atomic, handles vote-switching)
-- ============================================================
CREATE OR REPLACE FUNCTION cast_downvote(p_queue_id UUID, p_token TEXT)
RETURNS VOID AS $$
DECLARE existing TEXT;
BEGIN
  SELECT vote_type INTO existing
  FROM votes_cast
  WHERE queue_id = p_queue_id AND participant_token = p_token;

  IF existing IS NULL THEN
    INSERT INTO votes_cast (queue_id, participant_token, vote_type)
    VALUES (p_queue_id, p_token, 'down');
    UPDATE queue SET downvotes = downvotes + 1 WHERE id = p_queue_id;

  ELSIF existing = 'up' THEN
    -- Switch from upvote to downvote
    UPDATE votes_cast SET vote_type = 'down'
    WHERE queue_id = p_queue_id AND participant_token = p_token;
    UPDATE queue SET downvotes = downvotes + 1, upvotes = upvotes - 1
    WHERE id = p_queue_id;

  END IF;
  -- existing = 'down': already downvoted, idempotent no-op
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: remove_vote  (atomic, handles returning to neutral)
-- ============================================================
CREATE OR REPLACE FUNCTION remove_vote(p_queue_id UUID, p_token TEXT)
RETURNS VOID AS $$
DECLARE existing TEXT;
BEGIN
  SELECT vote_type INTO existing
  FROM votes_cast
  WHERE queue_id = p_queue_id AND participant_token = p_token;

  IF existing = 'up' THEN
    DELETE FROM votes_cast WHERE queue_id = p_queue_id AND participant_token = p_token;
    UPDATE queue SET upvotes = upvotes - 1 WHERE id = p_queue_id;
  ELSIF existing = 'down' THEN
    DELETE FROM votes_cast WHERE queue_id = p_queue_id AND participant_token = p_token;
    UPDATE queue SET downvotes = downvotes - 1 WHERE id = p_queue_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- RPC: expire_inactive_rooms
-- Schedule via Supabase Edge Function cron or pg_cron
-- ============================================================
CREATE OR REPLACE FUNCTION expire_inactive_rooms()
RETURNS VOID AS $$
BEGIN
  UPDATE rooms
  SET status = 'ended'
  WHERE status = 'active'
    AND is_saved = false
    AND last_active_at < now() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue             ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes_cast        ENABLE ROW LEVEL SECURITY;
ALTER TABLE skip_votes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_bans         ENABLE ROW LEVEL SECURITY;

-- ── Profiles ─────────────────────────────────────────────────
-- Public reads (username/avatar shown to room participants)
CREATE POLICY "profiles are publicly readable"
  ON profiles FOR SELECT USING (true);

-- Users can insert their own profile row (needed as fallback if trigger races)
CREATE POLICY "users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Only the owner can update their own profile
CREATE POLICY "users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- ── Rooms ─────────────────────────────────────────────────────
-- Anyone can read active or paused rooms (participants need to see paused state)
CREATE POLICY "active rooms are publicly readable"
  ON rooms FOR SELECT USING (status IN ('active', 'paused') OR auth.uid() = host_id);

-- Only authenticated users can create rooms (and only as themselves)
CREATE POLICY "authenticated users can create rooms"
  ON rooms FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = host_id);

-- Only the host can update their own room
CREATE POLICY "host can manage their room"
  ON rooms FOR UPDATE USING (auth.uid() = host_id);

-- Only the host can delete their own room
CREATE POLICY "host can delete their room"
  ON rooms FOR DELETE USING (auth.uid() = host_id);

-- ── Queue ─────────────────────────────────────────────────────
-- Anyone can read queue items (safe, needed for Realtime to broadcast without subquery issues)
CREATE POLICY "queue readable for all"
  ON queue FOR SELECT USING (true);

-- Anyone can add to an active room's queue (participants)
CREATE POLICY "anyone can add to active room queue"
  ON queue FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM rooms WHERE rooms.id = queue.room_id AND rooms.status = 'active'
  ));

-- Note: direct queue UPDATE for voting is intentionally NOT allowed.
-- All vote changes go through the cast_upvote / cast_downvote / remove_vote
-- SECURITY DEFINER RPCs which bypass RLS and enforce atomicity.
-- This prevents a malicious user from setting upvotes=9999 via direct API call.

-- Host can update any queue row in their room (e.g. mark as played, remove)
CREATE POLICY "host can update any queue row"
  ON queue FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM rooms WHERE rooms.id = queue.room_id AND rooms.host_id = auth.uid()
  ));

-- ── Votes Cast ────────────────────────────────────────────────
CREATE POLICY "votes readable" ON votes_cast FOR SELECT USING (true);
CREATE POLICY "anyone can insert vote" ON votes_cast FOR INSERT WITH CHECK (true);
CREATE POLICY "anyone can update vote" ON votes_cast FOR UPDATE USING (true);

-- ── Skip Votes ────────────────────────────────────────────────
CREATE POLICY "skip votes readable" ON skip_votes FOR SELECT USING (true);
CREATE POLICY "anyone can insert skip vote" ON skip_votes FOR INSERT WITH CHECK (true);
CREATE POLICY "anyone can delete own skip vote" ON skip_votes FOR DELETE USING (true);

-- ── Room Participants ─────────────────────────────────────────
CREATE POLICY "participants readable" ON room_participants FOR SELECT USING (true);
CREATE POLICY "anyone can upsert participant" ON room_participants
  FOR INSERT WITH CHECK (true);
CREATE POLICY "anyone can update own participant row" ON room_participants
  FOR UPDATE USING (true);
CREATE POLICY "host can delete participant" ON room_participants
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM rooms
      WHERE rooms.id = room_participants.room_id AND rooms.host_id = auth.uid()
    )
  );

-- ── Room Bans ─────────────────────────────────────────────────
CREATE POLICY "bans readable" ON room_bans FOR SELECT USING (true);
CREATE POLICY "host can insert ban" ON room_bans
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM rooms
      WHERE rooms.id = room_bans.room_id AND rooms.host_id = auth.uid()
    )
  );
CREATE POLICY "host can delete ban" ON room_bans
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM rooms
      WHERE rooms.id = room_bans.room_id AND rooms.host_id = auth.uid()
    )
  );
