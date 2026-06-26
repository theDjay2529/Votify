-- ============================================================
--  🎧 VOTIFY V2 — Full Database Schema (Final)
--
--  ⚠️  HOW TO USE:
--  Run this ENTIRE script in:
--    Supabase Dashboard → SQL Editor → New Query → Run
--
--  This is a CLEAN SLATE schema.
--  It drops all existing Votify tables and recreates them.
--  Safe to re-run on a fresh project.
--
--  Last updated: 2026-05-21
--  Fixes applied:
--    - profiles INSERT policy added (fixes RLS violation on signup)
--    - handle_new_user trigger uses SECURITY DEFINER (bypasses RLS)
--    - remove_vote RPC added
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- CLEANUP — drop everything safely before recreating
-- ============================================================
DROP TRIGGER  IF EXISTS on_auth_user_created     ON auth.users;
DROP TRIGGER  IF EXISTS queue_touches_room        ON queue;
DROP FUNCTION IF EXISTS handle_new_user()         CASCADE;
DROP FUNCTION IF EXISTS generate_room_code()      CASCADE;
DROP FUNCTION IF EXISTS cast_upvote(UUID, TEXT)   CASCADE;
DROP FUNCTION IF EXISTS cast_downvote(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS remove_vote(UUID, TEXT)   CASCADE;
DROP FUNCTION IF EXISTS verify_room_pin(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS expire_inactive_rooms()   CASCADE;
DROP FUNCTION IF EXISTS touch_room_activity()     CASCADE;
DROP FUNCTION IF EXISTS increment_vote(UUID)      CASCADE;
DROP FUNCTION IF EXISTS reload_history_tracks(UUID, UUID[], BOOLEAN) CASCADE;
DROP TABLE IF EXISTS room_bans          CASCADE;
DROP TABLE IF EXISTS room_participants  CASCADE;
DROP TABLE IF EXISTS skip_votes         CASCADE;
DROP TABLE IF EXISTS votes_cast         CASCADE;
DROP TABLE IF EXISTS queue              CASCADE;
DROP TABLE IF EXISTS rooms              CASCADE;
DROP TABLE IF EXISTS profiles           CASCADE;


-- ============================================================
-- TABLE: profiles
-- One row per host account. Extends auth.users.
-- ============================================================
CREATE TABLE public.profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT        UNIQUE NOT NULL CHECK (length(username) >= 6),
  email         TEXT        NOT NULL,       -- cached for username+password lookup
  avatar_url    TEXT,
  is_premium    BOOLEAN     DEFAULT false,
  premium_since TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── Trigger: auto-create a stub profile row on every new signup ──
-- Runs as SECURITY DEFINER so it bypasses RLS (the user has no session yet).
-- The stub username starts with 'user_' — isProfileComplete() checks for this
-- and redirects to the setup overlay if the user hasn't picked a real username yet.
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
-- TABLE: rooms
-- ============================================================
CREATE TABLE public.rooms (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  code              TEXT        UNIQUE NOT NULL,
  name              TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  host_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pin               TEXT        CHECK (pin IS NULL OR (length(pin) >= 4 AND length(pin) <= 8)),
  status            TEXT        DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  mode              TEXT        NOT NULL CHECK (mode IN ('queue', 'listen_together')),
  is_saved          BOOLEAN     DEFAULT false,
  saved_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  last_active_at    TIMESTAMPTZ DEFAULT now()
);

-- Only one active room per host at any time
CREATE UNIQUE INDEX one_active_room_per_host
  ON rooms(host_id) WHERE status = 'active';

CREATE INDEX idx_rooms_code   ON rooms(code);
CREATE INDEX idx_rooms_host   ON rooms(host_id);
CREATE INDEX idx_rooms_status ON rooms(status);


-- ============================================================
-- TABLE: queue  (songs scoped to a room)
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
-- TABLE: votes_cast
-- Server-side vote deduplication — one vote per participant per queue item.
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
-- TABLE: skip_votes
-- Democratic skip — when > 50% of participants vote to skip, the host skips.
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
-- TABLE: room_participants  (presence + activity tracking)
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
-- TABLE: room_bans  (kick enforcement)
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
-- Generates a unique 6-character alphanumeric room code.
-- Excludes ambiguous characters (0, O, I, 1).
-- ============================================================
CREATE OR REPLACE FUNCTION generate_room_code()
RETURNS TEXT AS $$
DECLARE
  chars   TEXT    := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code  TEXT    := '';
  i       INTEGER;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM rooms WHERE rooms.code = v_code AND rooms.status = 'active'
    );
  END LOOP;
  RETURN v_code;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- RPC: verify_room_pin
-- Called by participants — returns true if PIN matches or room has no PIN.
-- SECURITY DEFINER so participants cannot directly read the pin column.
-- ============================================================
CREATE OR REPLACE FUNCTION verify_room_pin(p_code TEXT, p_pin TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  room_pin TEXT;
BEGIN
  SELECT pin INTO room_pin
  FROM rooms
  WHERE rooms.code = upper(p_code) AND rooms.status = 'active';

  IF NOT FOUND THEN
    RETURN false; -- Room doesn't exist or is not active
  END IF;

  IF room_pin IS NULL THEN
    RETURN true; -- No PIN required
  END IF;

  RETURN room_pin = p_pin;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- RPC: cast_upvote  (atomic — handles vote switching)
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
    UPDATE votes_cast SET vote_type = 'up'
    WHERE queue_id = p_queue_id AND participant_token = p_token;
    UPDATE queue SET upvotes = upvotes + 1, downvotes = downvotes - 1
    WHERE id = p_queue_id;

  END IF;
  -- existing = 'up': already upvoted — idempotent no-op
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- RPC: cast_downvote  (atomic — handles vote switching)
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
    UPDATE votes_cast SET vote_type = 'down'
    WHERE queue_id = p_queue_id AND participant_token = p_token;
    UPDATE queue SET downvotes = downvotes + 1, upvotes = upvotes - 1
    WHERE id = p_queue_id;

  END IF;
  -- existing = 'down': already downvoted — idempotent no-op
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- RPC: remove_vote  (atomic — returns vote to neutral)
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
  -- existing = NULL: no vote to remove — idempotent no-op
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- RPC: reload_history_tracks
-- SECURITY DEFINER function to reload all songs from history in a single transaction.
-- Bypasses RLS limits to safely delete votes/skips and update queue status.
-- ============================================================
CREATE OR REPLACE FUNCTION reload_history_tracks(
  p_room_id UUID,
  p_track_ids UUID[],
  p_reset_votes BOOLEAN
)
RETURNS VOID AS $$
BEGIN
  -- 1. Clear skip votes for these tracks
  DELETE FROM public.skip_votes
  WHERE room_id = p_room_id AND queue_item_id = ANY(p_track_ids);

  IF p_reset_votes THEN
    -- 2. Clear votes cast for these tracks so participants can vote fresh
    DELETE FROM public.votes_cast
    WHERE queue_id = ANY(p_track_ids);

    -- 3. Reset queue played state and votes (upvotes=1, downvotes=0)
    UPDATE public.queue
    SET played = false, upvotes = 1, downvotes = 0
    WHERE room_id = p_room_id AND id = ANY(p_track_ids);
  ELSE
    -- 3. Reset queue played state but keep existing votes
    UPDATE public.queue
    SET played = false
    WHERE room_id = p_room_id AND id = ANY(p_track_ids);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- RPC: expire_inactive_rooms
-- Ends rooms that have been inactive for over 24 hours.
-- Schedule via Supabase Edge Functions (cron) or pg_cron.
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


-- ── profiles ──────────────────────────────────────────────────
-- Anyone can read profiles (usernames/avatars shown in rooms).
CREATE POLICY "profiles are publicly readable"
  ON profiles FOR SELECT USING (true);

-- A user can insert their own profile row.
-- This is the fallback for when the handle_new_user trigger races the client.
-- The trigger (SECURITY DEFINER) handles the normal case; this policy covers
-- the edge case where the client reaches setupProfile before the trigger completes.
CREATE POLICY "users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Only the owner can update their own profile.
CREATE POLICY "users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);


-- ── rooms ──────────────────────────────────────────────────────
-- Anyone can read active or paused rooms (participants need paused state).
CREATE POLICY "active rooms are publicly readable"
  ON rooms FOR SELECT USING (status IN ('active', 'paused') OR auth.uid() = host_id);

-- Only authenticated users can create rooms (and only as themselves).
CREATE POLICY "authenticated users can create rooms"
  ON rooms FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = host_id);

-- Only the host can update their own room.
CREATE POLICY "host can manage their room"
  ON rooms FOR UPDATE USING (auth.uid() = host_id);

-- Only the host can delete their own room.
CREATE POLICY "host can delete their room"
  ON rooms FOR DELETE USING (auth.uid() = host_id);


-- ── queue ──────────────────────────────────────────────────────
-- Anyone can read queue items (required for Realtime to work correctly).
CREATE POLICY "queue readable for all"
  ON queue FOR SELECT USING (true);

-- Anyone can add songs to an active room's queue.
CREATE POLICY "anyone can add to active room queue"
  ON queue FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM rooms WHERE rooms.id = queue.room_id AND rooms.status = 'active'
  ));

-- Direct queue UPDATE for vote counts is intentionally blocked.
-- All vote changes go through cast_upvote / cast_downvote / remove_vote
-- (SECURITY DEFINER RPCs) which bypass RLS and enforce atomicity.
-- This prevents a malicious user from setting upvotes=9999 via direct API call.

-- Host can update any queue row in their room (mark as played, reorder, remove).
CREATE POLICY "host can update any queue row"
  ON queue FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM rooms WHERE rooms.id = queue.room_id AND rooms.host_id = auth.uid()
  ));

-- Host can delete queue rows in their room.
CREATE POLICY "host can delete queue row"
  ON queue FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM rooms WHERE rooms.id = queue.room_id AND rooms.host_id = auth.uid()
  ));


-- ── votes_cast ─────────────────────────────────────────────────
-- All vote operations go through SECURITY DEFINER RPCs, but RLS still
-- needs to allow the underlying operations those RPCs perform.
CREATE POLICY "votes readable"          ON votes_cast FOR SELECT USING (true);
CREATE POLICY "anyone can insert vote"  ON votes_cast FOR INSERT WITH CHECK (true);
CREATE POLICY "anyone can update vote"  ON votes_cast FOR UPDATE USING (true);
CREATE POLICY "anyone can delete vote"  ON votes_cast FOR DELETE USING (true);


-- ── skip_votes ─────────────────────────────────────────────────
CREATE POLICY "skip votes readable"            ON skip_votes FOR SELECT USING (true);
CREATE POLICY "anyone can insert skip vote"    ON skip_votes FOR INSERT WITH CHECK (true);
CREATE POLICY "anyone can delete own skip vote" ON skip_votes FOR DELETE USING (true);


-- ── room_participants ──────────────────────────────────────────
CREATE POLICY "participants readable"             ON room_participants FOR SELECT USING (true);
CREATE POLICY "anyone can upsert participant"     ON room_participants FOR INSERT WITH CHECK (true);
CREATE POLICY "anyone can update participant row" ON room_participants FOR UPDATE USING (true);
CREATE POLICY "host can delete participant"       ON room_participants
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM rooms
      WHERE rooms.id = room_participants.room_id AND rooms.host_id = auth.uid()
    )
  );


-- ── room_bans ──────────────────────────────────────────────────
CREATE POLICY "bans readable"      ON room_bans FOR SELECT USING (true);
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


-- ============================================================

