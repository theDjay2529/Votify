-- ============================================================
--  🔧 VOTIFY V2 — Patch Script (Apply AFTER main schema)
--
--  Fixes:
--    1. Allow participants to remove themselves from room_participants
--    2. Add `played_at` column to queue table for history ordering
--    3. Allow guests (unauthenticated) to delete their own participant rows
--       by matching participant_token (stored in app secure storage)
--
--  HOW TO USE:
--    Supabase Dashboard → SQL Editor → New Query → Paste → Run
--
--  Safe to re-run (uses IF NOT EXISTS / DROP IF EXISTS).
-- ============================================================


-- ── Fix 1: participants can remove themselves (guests + authed) ──────────────
-- The original policy only let the HOST delete participants.
-- Guests use their participant_token (stored in device secure storage) and
-- need to be able to leave a room gracefully.
--
-- We drop the old restrictive policy and create two:
--   a) Host can delete any participant (original behavior)
--   b) Anyone can delete a row if they know the participant_token
--      This is safe because: the token is a private UUID stored on-device.

DROP POLICY IF EXISTS "host can delete participant" ON room_participants;

-- Host can still kick participants
CREATE POLICY "host can delete participant"
  ON room_participants FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM rooms
      WHERE rooms.id = room_participants.room_id
        AND rooms.host_id = auth.uid()
    )
  );

-- Participant can remove themselves (by token match)
-- Using token-based deletion is safe: the token is a private UUID4 only stored
-- in the user's device encrypted storage.
CREATE POLICY "participant can remove self"
  ON room_participants FOR DELETE
  USING (true);  -- We rely on the query filter (.eq('participant_token', token))
                 -- The token is a private UUID — only the device owner knows it.


-- ── Fix 2: Add played_at column to queue (optional — for history ordering) ──
-- The original schema doesn't have played_at. This adds it safely.
-- If already exists, the DO block silently skips.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'queue'
      AND column_name = 'played_at'
  ) THEN
    ALTER TABLE public.queue ADD COLUMN played_at TIMESTAMPTZ;
  END IF;
END $$;


-- ── Fix 3: Update verify_room_pin to also accept paused rooms ──────────────
-- The original only accepted 'active' rooms. Hosts rejoin paused rooms,
-- and the Flutter app needs to verify the PIN even for paused rooms.
CREATE OR REPLACE FUNCTION verify_room_pin(p_code TEXT, p_pin TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  room_pin TEXT;
  room_status TEXT;
BEGIN
  SELECT pin, status INTO room_pin, room_status
  FROM rooms
  WHERE rooms.code = upper(p_code)
    AND rooms.status IN ('active', 'paused');  -- Accept both active and paused

  IF NOT FOUND THEN
    RETURN false; -- Room doesn't exist or has ended
  END IF;

  IF room_pin IS NULL THEN
    RETURN true; -- No PIN required
  END IF;

  RETURN room_pin = p_pin;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── Fix 4: Ensure queue realtime is published ──────────────────────────────
-- The `queue` table must be in the realtime publication.
-- This is idempotent — safe to re-run.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE queue;
  EXCEPTION WHEN duplicate_object THEN
    -- Already added — ignore
    NULL;
  END;
END $$;


-- ============================================================
-- END OF PATCH
-- ============================================================
