import { supabase } from './supabase-config.js';

// ============================================================
//  VOTIFY V2 — Rooms Module
//  Handles: room creation, validation, lifecycle, PIN verification
// ============================================================

// ── Create a New Room ────────────────────────────────────────
export async function createRoom({ name, mode, pin }) {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error('Not authenticated.');

  // Hosts can keep multiple paused rooms, but only one room may be active.
  const existing = await getActiveRoom(user.id);
  if (existing) {
    const err = new Error('You already have an active room. Leave it first before creating a new one.');
    err.code = 'ROOM_EXISTS';
    err.room = existing;
    throw err;
  }

  // Generate unique room code via RPC
  const { data: code, error: codeErr } = await supabase.rpc('generate_room_code');
  if (codeErr) throw codeErr;

  const { data, error } = await supabase
    .from('rooms')
    .insert({
      code,
      name: name.trim(),
      host_id: user.id,
      mode,
      pin: pin ? String(pin).trim() : null,
      livekit_room_name: mode === 'listen_together' ? code : null,
      status: 'active',
    })
    .select('id, code, name, mode, pin')
    .single();

  if (error) throw error;
  return data;
}

// ── Get Active Room for a Host ───────────────────────────────
export async function getActiveRoom(hostId) {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, code, name, mode')
    .eq('host_id', hostId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ── Get Full Room Data (authenticated host only) ─────────────
// Returns active OR paused rooms so host can rejoin paused sessions.
export async function getRoomForHost(code) {
  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('code', code.toUpperCase())
    .in('status', ['active', 'paused'])
    .single();

  if (error) return null;
  return data;
}

// ── Get Room by Code (public, participant-facing) ─────────────
// Returns active OR paused rooms so participants can see paused state.
export async function getRoom(code) {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, code, name, mode, status')
    .eq('code', code.toUpperCase().trim())
    .in('status', ['active', 'paused'])
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ── Check if a Room Requires a PIN (public) ──────────────────
export async function roomRequiresPin(code) {
  // We use the verify RPC with no PIN — it returns true if no PIN is set
  const { data, error } = await supabase.rpc('verify_room_pin', {
    p_code: code.toUpperCase(),
    p_pin: '',
  });
  if (error) return false;
  return !data; // If verify with empty pin returns false → room has a PIN
}

// ── Verify Room PIN (participant-facing) ─────────────────────
// Calls a SECURITY DEFINER RPC — participant never reads pin column directly.
export async function verifyRoomPin(code, pin) {
  const { data, error } = await supabase.rpc('verify_room_pin', {
    p_code: code.toUpperCase(),
    p_pin: String(pin),
  });
  if (error) throw error;
  return data; // boolean
}

// ── Pause a Room (host leaves but room state is saved) ────────
export async function pauseRoom(roomId) {
  const { error } = await supabase
    .from('rooms')
    .update({ status: 'paused' })
    .eq('id', roomId);
  if (error) throw error;
}

// ── Reactivate a Paused Room ──────────────────────────────────
export async function activateRoom(roomId) {
  const { error } = await supabase
    .from('rooms')
    .update({ status: 'active' })
    .eq('id', roomId);
  if (error) throw error;
}

// ── End a Room ───────────────────────────────────────────────
// ── Delete a Room ────────────────────────────────────────────
export async function deleteRoom(roomId) {
  const { error } = await supabase
    .from('rooms')
    .delete()
    .eq('id', roomId);
  if (error) throw error;
}

// ── Get Paused Rooms for Host ─────────────────────────────────
export async function getPausedRooms(hostId) {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, code, name, mode, status, created_at')
    .eq('host_id', hostId)
    .eq('status', 'paused')
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

// ── Get Recent Rooms for Host (last 5) ───────────────────────
export async function getRecentRooms(hostId) {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, code, name, mode, status, created_at')
    .eq('host_id', hostId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) throw error;
  return data || [];
}

// ── Kick a Participant (ban from room) ───────────────────────
export async function kickParticipant(roomId, participantToken, displayName) {
  // Look up display_name from room_participants if not passed directly
  let name = displayName;
  if (!name) {
    const { data } = await supabase
      .from('room_participants')
      .select('display_name')
      .eq('room_id', roomId)
      .eq('participant_token', participantToken)
      .maybeSingle();
    name = data?.display_name || null;
  }

  const { error } = await supabase
    .from('room_bans')
    .insert({ room_id: roomId, participant_token: participantToken, display_name: name });
  if (error) throw error;

  await supabase
    .from('room_participants')
    .delete()
    .eq('room_id', roomId)
    .eq('participant_token', participantToken);
}

// ── Check if Participant is Banned ───────────────────────────
export async function isParticipantBanned(roomId, token) {
  const { data } = await supabase
    .from('room_bans')
    .select('id')
    .eq('room_id', roomId)
    .eq('participant_token', token)
    .maybeSingle();
  return !!data;
}

// ── Register / Heartbeat Participant Presence ─────────────────
export async function upsertParticipant(roomId, token, displayName, isGuest) {
  const { error } = await supabase
    .from('room_participants')
    .upsert(
      {
        room_id: roomId,
        participant_token: token,
        display_name: displayName,
        is_guest: isGuest,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'room_id,participant_token' }
    );
  if (error) console.error('[Votify] Participant upsert error:', error);
}

// ── Remove Participant on Voluntary Leave ─────────────────────
export async function removeParticipant(roomId, participantToken) {
  const { error } = await supabase
    .from('room_participants')
    .delete()
    .eq('room_id', roomId)
    .eq('participant_token', participantToken);
  if (error) console.error('[Votify] Remove participant error:', error);
}

// ── Get Participant List for Host ────────────────────────────
export async function getRoomParticipants(roomId) {
  const { data, error } = await supabase
    .from('room_participants')
    .select('*')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// ── Get Banned Participants for Host ─────────────────────────
export async function getBannedParticipants(roomId) {
  const { data, error } = await supabase
    .from('room_bans')
    .select('id, room_id, participant_token, display_name, banned_at')
    .eq('room_id', roomId)
    .order('banned_at', { ascending: false });
  if (error) return [];
  return data || [];
}

// ── Unban a Participant ───────────────────────────────────────
export async function unbanParticipant(roomId, participantToken) {
  const { error } = await supabase
    .from('room_bans')
    .delete()
    .eq('room_id', roomId)
    .eq('participant_token', participantToken);
  if (error) throw error;
}
