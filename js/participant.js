/* ============================================================
   🎧 VOTIFY — Participant Screen Logic
   Invidious Search + Supabase Vote/Queue + Anti-Spam
   ============================================================ */

import { supabase } from './supabase-config.js';

// ── Invidious Instances (open-source YouTube mirrors) ──
const INVIDIOUS_INSTANCES = [
  'https://vid.puffyan.us',
  'https://invidious.snopyta.org',
  'https://invidious.kavin.rocks',
  'https://y.com.sb',
];

// ── State ──
let searchTimeout = null;
const SEARCH_DEBOUNCE_MS = 400;

// ── DOM Elements ──
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
const searchSpinner = document.getElementById('search-spinner');
const resultsSection = document.getElementById('results-section');
const resultsList = document.getElementById('results-list');
const queueList = document.getElementById('queue-list');
const queueEmpty = document.getElementById('queue-empty');
const queueBadge = document.getElementById('queue-badge');
const nowPlayingTitle = document.getElementById('npm-title');
const toastContainer = document.getElementById('toast-container');
const reconnectBanner = document.getElementById('reconnect-banner');

// ── Anti-Spam: localStorage voted IDs ──
function getVotedIds() {
  try {
    return JSON.parse(localStorage.getItem('votify_voted_ids') || '[]');
  } catch {
    return [];
  }
}

function addVotedId(youtubeId) {
  const voted = getVotedIds();
  if (!voted.includes(youtubeId)) {
    voted.push(youtubeId);
    localStorage.setItem('votify_voted_ids', JSON.stringify(voted));
  }
}

function hasVoted(youtubeId) {
  return getVotedIds().includes(youtubeId);
}

// ── Toast System ──
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Invidious Search ──
async function searchYouTube(query) {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const response = await fetch(
        `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`
      );
      if (!response.ok) continue;
      const data = await response.json();
      return data
        .filter((item) => item.type === 'video')
        .slice(0, 8)
        .map((video) => ({
          youtube_id: video.videoId,
          title: video.title,
          thumbnail_url:
            video.videoThumbnails && video.videoThumbnails.length > 0
              ? video.videoThumbnails.find((t) => t.quality === 'medium')?.url ||
                video.videoThumbnails[0].url
              : `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`,
          author: video.author || '',
        }));
    } catch (e) {
      continue; // instance failed, try the next one
    }
  }
  throw new Error('All Invidious instances failed');
}

// ── Search Handler ──
function handleSearchInput() {
  const query = searchInput.value.trim();

  // Show/hide clear button
  if (query.length > 0) {
    searchClear.classList.remove('hidden');
  } else {
    searchClear.classList.add('hidden');
    resultsSection.classList.add('hidden');
    return;
  }

  // Debounce
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => performSearch(query), SEARCH_DEBOUNCE_MS);
}

async function performSearch(query) {
  if (!query || query.length < 2) return;

  // Show loading
  searchSpinner.classList.remove('hidden');
  resultsSection.classList.remove('hidden');

  // Show skeleton loaders
  resultsList.innerHTML = Array(4)
    .fill(0)
    .map(
      () => `
      <div class="result-skeleton">
        <div class="skeleton skeleton-thumb"></div>
        <div class="skeleton-info">
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text short"></div>
        </div>
      </div>
    `
    )
    .join('');

  try {
    const results = await searchYouTube(query);

    if (results.length === 0) {
      resultsList.innerHTML =
        '<p style="text-align:center;color:var(--text-muted);padding:var(--space-lg);">No results found</p>';
    } else {
      renderResults(results);
    }
  } catch (err) {
    console.error('[Votify] Search failed:', err);
    resultsList.innerHTML = '';
    showToast("Search is down right now — try again in a sec! 🎵", 'error');
  } finally {
    searchSpinner.classList.add('hidden');
  }
}

function renderResults(results) {
  resultsList.innerHTML = results
    .map(
      (r) => `
      <div class="result-card" data-ytid="${r.youtube_id}" data-title="${escapeAttr(r.title)}" data-thumb="${escapeAttr(r.thumbnail_url)}">
        <img class="result-thumb" src="${r.thumbnail_url}" alt="" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${r.youtube_id}/mqdefault.jpg'" />
        <div class="result-info">
          <div class="result-title">${escapeHtml(r.title)}</div>
          <div class="result-author">${escapeHtml(r.author)}</div>
        </div>
        <div class="result-add-icon">+</div>
      </div>
    `
    )
    .join('');

  // Add click listeners
  resultsList.querySelectorAll('.result-card').forEach((card) => {
    card.addEventListener('click', () => handleAddSong(card));
  });
}

// ── Add Song / Vote ──
async function handleAddSong(card) {
  const youtubeId = card.dataset.ytid;
  const title = card.dataset.title;
  const thumbnailUrl = card.dataset.thumb;

  // Visual feedback
  card.classList.add('adding');

  try {
    // Check if song already exists in queue (unplayed)
    const { data: existing, error: fetchError } = await supabase
      .from('queue')
      .select('id')
      .eq('youtube_id', youtubeId)
      .eq('played', false)
      .limit(1);

    if (fetchError) throw fetchError;

    if (existing && existing.length > 0) {
      // Song exists — upvote it
      if (hasVoted(youtubeId)) {
        showToast("You already hyped this track! 🔥", 'info');
        card.classList.remove('adding');
        return;
      }

      const { error: rpcError } = await supabase.rpc('increment_vote', {
        row_id: existing[0].id,
      });
      if (rpcError) throw rpcError;

      addVotedId(youtubeId);
      showToast('Vote added! 🗳️🔥', 'success');
    } else {
      // New song — insert
      // Check if already voted (for re-added songs)
      if (hasVoted(youtubeId)) {
        // Still insert but don't block — they may have voted on a previous round
      }

      const { error: insertError } = await supabase.from('queue').insert({
        youtube_id: youtubeId,
        title: title,
        thumbnail_url: thumbnailUrl,
        votes: 1,
      });

      if (insertError) throw insertError;

      addVotedId(youtubeId);
      showToast('Song added to queue! 🎶', 'success');
    }
  } catch (err) {
    console.error('[Votify] Error adding song:', err);
    showToast('Failed to add song — try again', 'error');
  } finally {
    card.classList.remove('adding');
  }
}

// ── Vote Handler (from queue) ──
async function handleVote(songId, youtubeId) {
  if (hasVoted(youtubeId)) {
    showToast("You already hyped this track! 🔥", 'info');
    return;
  }

  try {
    const { error } = await supabase.rpc('increment_vote', { row_id: songId });
    if (error) throw error;

    addVotedId(youtubeId);
    showToast('Vote added! 🗳️🔥', 'success');
  } catch (err) {
    console.error('[Votify] Vote error:', err);
    showToast('Failed to vote — try again', 'error');
  }
}

// ── Queue Display ──
async function refreshQueueDisplay() {
  try {
    const { data, error } = await supabase
      .from('queue')
      .select('*')
      .eq('played', false)
      .order('votes', { ascending: false });

    if (error) throw error;

    const songs = data || [];
    queueBadge.textContent = songs.length;

    // Update now playing indicator
    if (songs.length > 0) {
      // The top song is likely playing on host
      nowPlayingTitle.textContent = songs[0].title;
    } else {
      nowPlayingTitle.textContent = 'Waiting for songs...';
    }

    // Render queue (skip #1 since it's "now playing")
    const upNext = songs.slice(1);

    if (upNext.length === 0 && songs.length <= 1) {
      queueEmpty.classList.remove('hidden');
      queueList.innerHTML = '';
      if (songs.length === 1) {
        queueEmpty.querySelector('p').textContent = 'This is the only song — add more!';
      } else {
        queueEmpty.querySelector('p').textContent = 'No songs in the queue yet';
      }
    } else {
      queueEmpty.classList.add('hidden');
      renderQueue(upNext);
    }
  } catch (err) {
    console.error('[Votify] Error refreshing queue:', err);
  }
}

function renderQueue(songs) {
  queueList.innerHTML = songs
    .map((song, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      const voted = hasVoted(song.youtube_id);
      return `
        <div class="queue-card" data-id="${song.id}" data-ytid="${song.youtube_id}">
          <span class="queue-card-rank ${rankClass}">${i + 2}</span>
          <img class="queue-card-thumb" src="${song.thumbnail_url || ''}" alt="" loading="lazy" onerror="this.style.display='none'" />
          <div class="queue-card-info">
            <div class="queue-card-title" title="${escapeAttr(song.title)}">${escapeHtml(song.title)}</div>
          </div>
          <button class="vote-btn ${voted ? 'voted' : ''}" data-id="${song.id}" data-ytid="${song.youtube_id}" aria-label="Vote for ${escapeAttr(song.title)}">
            <span class="vote-arrow">${voted ? '✓' : '▲'}</span>
            <span class="vote-count">${song.votes}</span>
          </button>
        </div>
      `;
    })
    .join('');

  // Attach vote listeners
  queueList.querySelectorAll('.vote-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleVote(btn.dataset.id, btn.dataset.ytid);
    });
  });
}

// ── Supabase Realtime ──
function setupRealtime() {
  const channel = supabase
    .channel('participant-queue-updates')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'queue',
      },
      (payload) => {
        console.log('[Votify] Realtime update:', payload.eventType);
        refreshQueueDisplay();
      }
    )
    .subscribe((status) => {
      console.log('[Votify] Realtime status:', status);
      if (status === 'SUBSCRIBED') {
        reconnectBanner.classList.remove('visible');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reconnectBanner.classList.add('visible');
        showToast('Connection lost — reconnecting...', 'error');
        setTimeout(() => channel.subscribe(), 3000);
      }
    });
}

// ── Utility: HTML Escaping ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Event Listeners ──
searchInput.addEventListener('input', handleSearchInput);

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.classList.add('hidden');
  resultsSection.classList.add('hidden');
  resultsList.innerHTML = '';
  searchInput.focus();
});

// Submit on Enter key
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimeout);
    performSearch(searchInput.value.trim());
  }
});

// ── Initialize ──
async function init() {
  console.log('[Votify] Participant screen initializing...');

  // Load initial queue
  await refreshQueueDisplay();

  // Set up realtime
  setupRealtime();

  // Focus search input
  searchInput.focus();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
