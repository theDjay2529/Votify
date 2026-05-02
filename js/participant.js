/* ============================================================
   🎧 VOTIFY — Participant Screen Logic
   Invidious Search + Supabase Vote/Queue + Anti-Spam
   ============================================================ */

import { supabase } from './supabase-config.js';

// ── Search Instances (Piped + Invidious) ──
const PIPED_INSTANCES = [
  'https://api.piped.private.coffee',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.syncpundit.io'
];

const INVIDIOUS_INSTANCES = [
  'https://inv.thepixora.com',
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
  'https://invidious.jing.rocks'
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

function removeVotedId(youtubeId) {
  const voted = getVotedIds();
  const index = voted.indexOf(youtubeId);
  if (index > -1) {
    voted.splice(index, 1);
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

// ── YouTube Search (Piped API + Invidious Fallback) ──
async function searchYouTube(query) {
  // Try Piped instances first
  for (const instance of PIPED_INSTANCES) {
    try {
      const response = await fetch(`${instance}/search?q=${encodeURIComponent(query)}&filter=videos`);
      if (!response.ok) continue;
      const data = await response.json();
      if (data && data.items) {
        return data.items.slice(0, 8).map(video => ({
          youtube_id: video.url.replace('/watch?v=', ''),
          title: video.title,
          thumbnail_url: video.thumbnail || `https://i.ytimg.com/vi/${video.url.replace('/watch?v=', '')}/mqdefault.jpg`,
          author: video.uploaderName || '',
        }));
      }
    } catch (e) {
      console.warn(`[Votify] Piped instance ${instance} failed`);
      continue;
    }
  }

  // Try Invidious instances as fallback
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
      console.warn(`[Votify] Invidious instance ${instance} failed`);
      continue; // instance failed, try the next one
    }
  }
  throw new Error('All search instances failed');
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
      const existingId = existing[0].id;
      // Song exists — upvote it
      if (hasVoted(existingId)) {
        showToast("You already hyped this track! 🔥", 'info');
        card.classList.remove('adding');
        return;
      }

      const { error: rpcError } = await supabase.rpc('increment_vote', {
        row_id: existingId,
      });
      if (rpcError) throw rpcError;

      addVotedId(existingId);
      showToast('Vote added! 🗳️🔥', 'success');
    } else {
      // New song — insert
      const { data, error: insertError } = await supabase.from('queue').insert({
        youtube_id: youtubeId,
        title: title,
        thumbnail_url: thumbnailUrl,
        votes: 1,
      }).select();

      if (insertError) throw insertError;

      addVotedId(data[0].id);
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
async function handleVote(songId) {
  const isVoted = hasVoted(songId);

  try {
    if (isVoted) {
      // Unvote: fetch current votes and decrement
      const { data, error: fetchErr } = await supabase
        .from('queue')
        .select('votes')
        .eq('id', songId)
        .single();
        
      if (fetchErr) throw fetchErr;
      
      const newVotes = Math.max(0, data.votes - 1);
      
      const { error: updateErr } = await supabase
        .from('queue')
        .update({ votes: newVotes })
        .eq('id', songId);
        
      if (updateErr) throw updateErr;
      
      removeVotedId(songId);
      showToast('Vote removed 💔', 'info');
    } else {
      // Upvote
      const { error } = await supabase.rpc('increment_vote', { row_id: songId });
      if (error) throw error;

      addVotedId(songId);
      showToast('Vote added! 🗳️🔥', 'success');
    }
    
    // Optimistic UI update
    const btn = document.querySelector(`.vote-btn[data-id="${songId}"]`);
    if (btn) {
      if (isVoted) {
        btn.classList.remove('voted');
        btn.querySelector('.vote-arrow').innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h4v7a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-7h4a1.001 1.001 0 0 0 .781-1.625l-8-10c-.381-.475-1.181-.475-1.562 0l-8 10A1.001 1.001 0 0 0 4 14z"/></svg>';
        btn.querySelector('.vote-count').textContent = Math.max(0, parseInt(btn.querySelector('.vote-count').textContent) - 1);
      } else {
        btn.classList.add('voted');
        btn.querySelector('.vote-arrow').innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M4 14h4v7a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-7h4a1.001 1.001 0 0 0 .781-1.625l-8-10c-.381-.475-1.181-.475-1.562 0l-8 10A1.001 1.001 0 0 0 4 14z"/></svg>';
        btn.querySelector('.vote-count').textContent = parseInt(btn.querySelector('.vote-count').textContent) + 1;
      }
    }

  } catch (err) {
    console.error('[Votify] Vote error:', err);
    showToast('Failed to update vote — try again', 'error');
  }
}

// ── Queue Display ──
let remoteCurrentSong = null;

async function refreshQueueDisplay() {
  try {
    const { data, error } = await supabase
      .from('queue')
      .select('*')
      .eq('played', false)
      .order('votes', { ascending: false })
      .order('created_at', { ascending: true }); // Match host sort

    if (error) throw error;

    const songs = data || [];
    queueBadge.textContent = songs.length;

    // Determine playing song and up next
    let playingSong = null;
    let upNext = [];

    if (remoteCurrentSong) {
      // Host told us exactly what is playing
      playingSong = remoteCurrentSong;
      upNext = songs.filter(s => s.id !== remoteCurrentSong.id);
    } else {
      // Fallback if host is offline or hasn't synced yet
      if (songs.length > 0) {
        playingSong = songs[0];
        upNext = songs.slice(1);
      }
    }

    if (playingSong) {
      nowPlayingTitle.textContent = playingSong.title;
    } else {
      nowPlayingTitle.textContent = 'Waiting for songs...';
    }

    // Render queue
    if (upNext.length === 0 && songs.length <= (playingSong ? 1 : 0)) {
      queueEmpty.classList.remove('hidden');
      Array.from(queueList.children).forEach(c => {
        if (c.id !== 'queue-empty') c.remove();
      });
      if (songs.length === 1 && playingSong) {
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
  // 1. Record current positions (First)
  const oldRects = new Map();
  Array.from(queueList.children).forEach(child => {
    if (child.dataset.id) {
      oldRects.set(child.dataset.id, child.getBoundingClientRect());
    }
  });

  // 2. Remove deleted elements
  const newIds = new Set(songs.map(s => s.id));
  Array.from(queueList.children).forEach(child => {
    if (child.dataset.id && !newIds.has(child.dataset.id)) {
      child.remove();
    }
  });

  // 3. Update existing or Add new (Last)
  songs.forEach((song, i) => {
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const voted = hasVoted(song.id);
    let card = queueList.querySelector(`.queue-card[data-id="${song.id}"]`);
    
    const svgIcon = voted
      ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M4 14h4v7a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-7h4a1.001 1.001 0 0 0 .781-1.625l-8-10c-.381-.475-1.181-.475-1.562 0l-8 10A1.001 1.001 0 0 0 4 14z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h4v7a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-7h4a1.001 1.001 0 0 0 .781-1.625l-8-10c-.381-.475-1.181-.475-1.562 0l-8 10A1.001 1.001 0 0 0 4 14z"/></svg>';

    if (!card) {
      card = document.createElement('div');
      card.className = 'queue-card';
      card.dataset.id = song.id;
      
      card.innerHTML = `
        <span class="queue-card-rank ${rankClass}">${i + 1}</span>
        <img class="queue-card-thumb" src="${song.thumbnail_url || ''}" alt="" loading="lazy" onerror="this.style.display='none'" />
        <div class="queue-card-info">
          <div class="queue-card-title" title="${escapeAttr(song.title)}">${escapeHtml(song.title)}</div>
        </div>
        <button class="vote-btn ${voted ? 'voted' : ''}" data-id="${song.id}" aria-label="Vote for ${escapeAttr(song.title)}">
          <span class="vote-arrow">${svgIcon}</span>
          <span class="vote-count">${song.votes}</span>
        </button>
      `;
      
      // Attach vote listener
      const btn = card.querySelector('.vote-btn');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleVote(btn.dataset.id);
      });
      
      queueList.appendChild(card);
    } else {
      // Update contents
      card.querySelector('.queue-card-rank').className = `queue-card-rank ${rankClass}`;
      card.querySelector('.queue-card-rank').textContent = i + 1;
      card.querySelector('.vote-count').textContent = song.votes;
      
      const btn = card.querySelector('.vote-btn');
      if (voted) btn.classList.add('voted');
      else btn.classList.remove('voted');
      btn.querySelector('.vote-arrow').innerHTML = svgIcon;
      
      // Re-append to DOM to fix ordering
      queueList.appendChild(card);
    }
  });

  // 4. Invert & Play (FLIP)
  Array.from(queueList.children).forEach(child => {
    const id = child.dataset.id;
    if (!id) return;
    const oldRect = oldRects.get(id);
    const newRect = child.getBoundingClientRect();
    
    if (oldRect) {
      const deltaY = oldRect.top - newRect.top;
      if (deltaY !== 0) {
        // Invert
        child.style.transform = `translateY(${deltaY}px)`;
        child.style.transition = 'none';
        
        // Play
        requestAnimationFrame(() => {
          child.style.transform = '';
          child.style.transition = 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';
        });
      }
    }
  });
}

// ── Supabase Realtime ──
function setupRealtime() {
  const channel = supabase.channel('votify-sync');

  channel
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
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      let foundHost = false;
      for (const id in state) {
        for (const presence of state[id]) {
          if (presence.isHost) {
            remoteCurrentSong = presence.currentSong;
            foundHost = true;
            break;
          }
        }
        if (foundHost) break;
      }
      if (!foundHost) remoteCurrentSong = null;
      refreshQueueDisplay();
    })
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
