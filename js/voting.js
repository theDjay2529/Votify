import { supabase } from './supabase-config.js';

// ============================================================
//  VOTIFY V2 — Voting Module
//  Handles: upvote, downvote, skip votes, local vote state
// ============================================================

const LOCAL_VOTE_KEY = 'votify_vote_state'; // { [queueId]: 'up' | 'down' }
const LOCAL_SKIP_KEY = 'votify_skip_votes'; // Set of queueItemIds

// ── Local Vote State (optimistic UI) ─────────────────────────
export function getLocalVoteState() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_VOTE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function getVoteForItem(queueId) {
  return getLocalVoteState()[queueId] ?? null; // 'up' | 'down' | null
}

export function setLocalVote(queueId, type) {
  const state = getLocalVoteState();
  state[queueId] = type;
  localStorage.setItem(LOCAL_VOTE_KEY, JSON.stringify(state));
}

export function clearLocalVote(queueId) {
  const state = getLocalVoteState();
  delete state[queueId];
  localStorage.setItem(LOCAL_VOTE_KEY, JSON.stringify(state));
}

// ── Upvote ───────────────────────────────────────────────────
// Calls the atomic cast_upvote RPC (handles vote-switching at DB level).
// participantToken: guest UUID or auth user ID string
export async function castUpvote(queueId, participantToken) {
  const { error } = await supabase.rpc('cast_upvote', {
    p_queue_id: queueId,
    p_token: participantToken,
  });
  if (error) throw error;
  setLocalVote(queueId, 'up');
}

// ── Downvote ─────────────────────────────────────────────────
export async function castDownvote(queueId, participantToken) {
  const { error } = await supabase.rpc('cast_downvote', {
    p_queue_id: queueId,
    p_token: participantToken,
  });
  if (error) throw error;
  setLocalVote(queueId, 'down');
}

// ── Remove Vote (Toggle Off) ───────────────────────────────────
export async function removeVote(queueId, participantToken) {
  const { error } = await supabase.rpc('remove_vote', {
    p_queue_id: queueId,
    p_token: participantToken,
  });
  if (error) throw error;
  clearLocalVote(queueId);
}

// ── Skip Vote ────────────────────────────────────────────────
export function hasSubmittedSkipVote(queueItemId) {
  try {
    const skips = JSON.parse(localStorage.getItem(LOCAL_SKIP_KEY) || '[]');
    return skips.includes(queueItemId);
  } catch {
    return false;
  }
}

function recordLocalSkipVote(queueItemId) {
  try {
    const skips = JSON.parse(localStorage.getItem(LOCAL_SKIP_KEY) || '[]');
    if (!skips.includes(queueItemId)) {
      skips.push(queueItemId);
      localStorage.setItem(LOCAL_SKIP_KEY, JSON.stringify(skips));
    }
  } catch {/* ignore */}
}

export function clearLocalSkipVotes() {
  localStorage.removeItem(LOCAL_SKIP_KEY);
}

export async function submitSkipVote(roomId, queueItemId, participantToken) {
  if (hasSubmittedSkipVote(queueItemId)) {
    throw new Error('Already voted to skip this song.');
  }

  const { error } = await supabase
    .from('skip_votes')
    .insert({
      room_id: roomId,
      queue_item_id: queueItemId,
      participant_token: participantToken,
    });

  if (error) {
    if (error.code === '23505') throw new Error('Already voted to skip this song.');
    throw error;
  }

  recordLocalSkipVote(queueItemId);
}

// ── Get Current Skip Vote Count ───────────────────────────────
export async function getSkipVoteCount(roomId, queueItemId) {
  const { count, error } = await supabase
    .from('skip_votes')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', roomId)
    .eq('queue_item_id', queueItemId);

  if (error) return 0;
  return count || 0;
}

// ── Clear Skip Votes for a Queue Item (after skip happens) ───
export async function clearSkipVotes(roomId, queueItemId) {
  await supabase
    .from('skip_votes')
    .delete()
    .eq('room_id', roomId)
    .eq('queue_item_id', queueItemId);
}
