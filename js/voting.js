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

// ── Sync Local Storage Cache from DB ──────────────────────────
export async function syncLocalStateFromDB(roomId, participantToken) {
  if (!participantToken) return;
  try {
    // 1. Fetch all votes cast by this participant in the current room
    const { data: dbVotes, error: votesError } = await supabase
      .from('votes_cast')
      .select('queue_id, vote_type, queue!inner(room_id)')
      .eq('participant_token', participantToken)
      .eq('queue.room_id', roomId);

    if (!votesError && dbVotes) {
      const state = {};
      for (const row of dbVotes) {
        state[row.queue_id] = row.vote_type;
      }
      localStorage.setItem(LOCAL_VOTE_KEY, JSON.stringify(state));
    }

    // 2. Fetch all skip votes cast by this participant in the current room
    const { data: dbSkips, error: skipsError } = await supabase
      .from('skip_votes')
      .select('queue_item_id')
      .eq('room_id', roomId)
      .eq('participant_token', participantToken);

    if (!skipsError && dbSkips) {
      const skips = dbSkips.map(row => row.queue_item_id);
      localStorage.setItem(LOCAL_SKIP_KEY, JSON.stringify(skips));
    }
  } catch (err) {
    console.error('Failed to sync local voting states from DB', err);
  }
}

// ── Handle Local Reload Cache Cleanups ─────────────────────────
export function handleReloadLocalCleanups(type, ids) {
  if (!ids || !ids.length) return;
  
  // 1. Always discard skip votes for reloaded items
  try {
    const skips = JSON.parse(localStorage.getItem(LOCAL_SKIP_KEY) || '[]');
    const filteredSkips = skips.filter(id => !ids.includes(id));
    localStorage.setItem(LOCAL_SKIP_KEY, JSON.stringify(filteredSkips));
  } catch (err) {
    console.error('Error clearing local skips', err);
  }

  // 2. If resetting votes, discard vote states
  if (type === 'reset') {
    try {
      const votes = JSON.parse(localStorage.getItem(LOCAL_VOTE_KEY) || '{}');
      for (const id of ids) {
        delete votes[id];
      }
      localStorage.setItem(LOCAL_VOTE_KEY, JSON.stringify(votes));
    } catch (err) {
      console.error('Error clearing local votes', err);
    }
  }
}
