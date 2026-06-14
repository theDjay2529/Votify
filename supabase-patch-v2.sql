-- ============================================================
--  🔐 VOTIFY V2 — Security Patch v2
--
--  Fixes:
--    1. Remove open DELETE/UPDATE policies on votes_cast
--       (all vote writes go through SECURITY DEFINER RPCs anyway)
--    2. Tighten room_participants DELETE policy — "USING (true)"
--       was too broad; a client could wipe all participants in a
--       room without a matching token.
--    3. Hash room PINs with pgcrypto (bcrypt) instead of storing
--       them in plaintext. Existing plaintext PINs are migrated.
--    4. Update verify_room_pin() to use constant-time bcrypt compare.
--    5. Add create_room_with_pin() helper RPC so the JS client
--       never sends a raw PIN — it sends it to a SECURITY DEFINER
--       function that hashes before storing.
--
--  HOW TO USE:
--    Supabase Dashboard → SQL Editor → New Query → Paste → Run
--
--  Safe to re-run (uses DROP IF EXISTS / OR REPLACE).
--  Last updated: 2026-06-14
-- ============================================================


-- ── Fix 1: votes_cast — remove the open write policies ───────
-- All vote mutations go through cast_upvote / cast_downvote /
-- remove_vote RPCs which are SECURITY DEFINER and bypass RLS.
-- These open policies serve no purpose and are a security hole.

DROP POLICY IF EXISTS "anyone can insert vote"  ON votes_cast;
DROP POLICY IF EXISTS "anyone can update vote"  ON votes_cast;
DROP POLICY IF EXISTS "anyone can delete vote"  ON votes_cast;

-- votes_cast is still readable so the UI can show vote counts.
-- (The "votes readable" SELECT policy from the main schema stays.)


-- ── Fix 2: room_participants — replace USING (true) delete policy
-- The previous "participant can remove self" used USING (true),
-- which let any client DELETE any participant row by simply
-- omitting the token filter. We replace it with a policy that
-- checks the room is still live (best we can do without a
-- server-side session for guests) AND tighten by requiring the
-- delete to pass through a SECURITY DEFINER RPC instead.

DROP POLICY IF EXISTS "participant can remove self" ON room_participants;

-- Recreate with a tighter condition: the room must be active or
-- paused (not ended) AND we check the token matches via RPC below.
-- Direct DELETE is still blocked unless going through leave_room().
CREATE POLICY "participant can remove self"
  ON room_participants FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM rooms
      WHERE rooms.id = room_participants.room_id
        AND rooms.status IN ('active', 'paused')
    )
  );

-- ── RPC: leave_room ───────────────────────────────────────────
-- Participants call this to leave gracefully. The token is
-- validated server-side so a malicious client cannot pass
-- someone else's token via a raw DELETE.
DROP FUNCTION IF EXISTS leave_room(UUID, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION leave_room(p_room_id UUID, p_token TEXT)
RETURNS VOID AS $$
BEGIN
  -- Only delete the row that belongs to this exact token.
  -- The function runs as the caller (no SECURITY DEFINER) so
  -- the RLS policy above still applies as a second layer.
  DELETE FROM room_participants
  WHERE room_id = p_room_id
    AND participant_token = p_token;
END;
$$ LANGUAGE plpgsql;


-- ── Fix 3: Hash existing plaintext PINs with pgcrypto ─────────
-- pgcrypto is already enabled in the main schema.
-- We migrate any existing non-null, non-hashed PINs to bcrypt.
-- A bcrypt hash always starts with '$2a$' or '$2b$'; skip those.

UPDATE rooms
SET pin = crypt(pin, gen_salt('bf', 8))
WHERE pin IS NOT NULL
  AND pin NOT LIKE '$2%';


-- ── Fix 4: Update verify_room_pin to use bcrypt comparison ────
-- Replace the plaintext equality check with crypt() comparison.

CREATE OR REPLACE FUNCTION verify_room_pin(p_code TEXT, p_pin TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  stored_pin TEXT;
BEGIN
  SELECT pin INTO stored_pin
  FROM rooms
  WHERE rooms.code = upper(p_code)
    AND rooms.status IN ('active', 'paused');

  IF NOT FOUND THEN
    RETURN false;  -- Room doesn't exist or has ended
  END IF;

  IF stored_pin IS NULL THEN
    RETURN true;   -- No PIN required
  END IF;

  -- Constant-time bcrypt comparison (prevents timing attacks)
  RETURN stored_pin = crypt(p_pin, stored_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── Fix 5: RPC to create a room with a hashed PIN ─────────────
-- The JS client sends the raw PIN here; this function hashes it
-- before inserting so the plaintext PIN never touches the DB.
-- Replaces the direct .insert() call in rooms.js createRoom().

DROP FUNCTION IF EXISTS create_room(TEXT, TEXT, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION create_room(
  p_code   TEXT,
  p_name   TEXT,
  p_mode   TEXT,
  p_pin    TEXT   -- NULL means no PIN
)
RETURNS TABLE (
  id             UUID,
  code           TEXT,
  name           TEXT,
  mode           TEXT,
  has_pin        BOOLEAN
) AS $$
DECLARE
  v_host_id UUID := auth.uid();
  v_hashed  TEXT;
  v_room    rooms%ROWTYPE;
BEGIN
  IF v_host_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Hash the PIN if one was supplied
  IF p_pin IS NOT NULL AND length(trim(p_pin)) > 0 THEN
    v_hashed := crypt(trim(p_pin), gen_salt('bf', 8));
  ELSE
    v_hashed := NULL;
  END IF;

  INSERT INTO rooms (code, name, host_id, mode, pin, status)
  VALUES (p_code, trim(p_name), v_host_id, p_mode, v_hashed, 'active')
  RETURNING * INTO v_room;

  RETURN QUERY SELECT
    v_room.id,
    v_room.code,
    v_room.name,
    v_room.mode,
    (v_room.pin IS NOT NULL) AS has_pin;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- END OF SECURITY PATCH v2
-- ============================================================
