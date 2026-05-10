/* ============================================================
   🎧 VOTIFY — Participant Logic (V2)
   Full realtime sync with host queue, paused room support,
   fixed syncChannel scope, and exact queue parity.
   ============================================================ */

import { supabase } from './supabase-config.js';
import { getOrCreateGuestToken, getUser } from './auth.js';
import { getRoom, upsertParticipant, isParticipantBanned } from './rooms.js';
import { castUpvote, castDownvote, removeVote, submitSkipVote, getVoteForItem, getSkipVoteCount } from './voting.js';

// ── State ──
let roomCode = null;
let roomData = null;
let participantToken = null;
let displayName = 'Guest';
let isGuest = true;
let queue = [];
let currentSong = null;
let presenceCount = 1;
let searchTimeout = null;
let syncChannel = null; // MODULE-LEVEL — shared by all functions
let roomIsPaused = false;
let listenPlayer = null;
let isListenPlayerReady = false;
let isListeningActive = false;
let lastSongUpdatedAt = 0;

// ── DOM Elements ──
const searchInput     = document.getElementById('search-input');
const searchClear     = document.getElementById('search-clear');
const searchSpinner   = document.getElementById('search-spinner');
const resultsList     = document.getElementById('results-list');
const resultsSection  = document.getElementById('results-section');
const queueList       = document.getElementById('queue-list');
const queueEmpty      = document.getElementById('queue-empty');
const queueBadge      = document.getElementById('queue-badge');
const nowPlayingMini  = document.getElementById('now-playing-mini');
const npmTitle        = document.getElementById('npm-title');
const skipBtn         = document.getElementById('btn-skip-vote');
const skipText        = document.getElementById('skip-vote-text');
const identityModal   = document.getElementById('identity-modal');
const statusModal     = document.getElementById('status-modal');
const toastContainer  = document.getElementById('toast-container');
const reconnectBanner = document.getElementById('reconnect-banner');
const headerRoom      = document.getElementById('p-header-room');
const listenPanel     = document.getElementById('listen-panel');
const listenStatus    = document.getElementById('listen-status');
const btnStartListening = document.getElementById('btn-start-listening');
const btnResyncAudio  = document.getElementById('btn-resync-audio');
const listenVolume    = document.getElementById('listen-volume');
const listenAudioContainer = document.getElementById('listen-audio-container');

// ── Init ─────────────────────────────────────────────────────
async function init() {
  const params = new URLSearchParams(window.location.search);
  roomCode = params.get('room')?.toUpperCase();

  if (!roomCode) {
    window.location.replace('/join.html');
    return;
  }

  // 1. Validate room (returns active OR paused)
  roomData = await getRoom(roomCode);
  if (!roomData) {
    showStatusModal('🚪', 'Room Not Found', 'This room code is invalid or the session has ended.');
    return;
  }

  if (headerRoom) headerRoom.textContent = roomData.name;

  // 2. Resolve identity
  await resolveIdentity(params);

  // 3. Check bans
  const banned = await isParticipantBanned(roomData.id, participantToken);
  if (banned) {
    showStatusModal('🚫', 'Banned', 'You have been removed from this room by the host.');
    return;
  }

  // 4. Handle paused state
  if (roomData.status === 'paused') {
    roomIsPaused = true;
    showPausedBanner(true);
  }

  // 5. Register presence
  await upsertParticipant(roomData.id, participantToken, displayName, isGuest);

  // 6. Load queue
  await refreshQueue();

  // 7. Realtime
  setupRealtime();
  setupListenTogetherParticipant();

  if (!roomIsPaused) {
    showToast(`Joined ${roomData.name}! 🎧`, 'success');
  }
}

// ── Paused Banner ─────────────────────────────────────────────
function setupListenTogetherParticipant() {
  if (roomData.mode !== 'listen_together') return;
  listenPanel?.classList.remove('hidden');

  btnStartListening?.addEventListener('click', startListening);
  
  // Resync button allows manual nudge
  btnResyncAudio?.addEventListener('click', () => {
     if (listenPlayer && isListenPlayerReady && currentSong) {
        listenPlayer.pauseVideo();
        setListenStatus('Resyncing...');
        // The next broadcast ping from host will resume it in sync.
     }
  });

  listenVolume?.addEventListener('input', (e) => {
    if (listenPlayer && isListenPlayerReady) {
      listenPlayer.setVolume(e.target.value);
    }
  });
}

async function startListening() {
  btnStartListening.disabled = true;
  btnStartListening.textContent = 'Connecting...';
  
  if (!window.YT || !window.YT.Player) {
    await new Promise(r => {
      const interval = setInterval(() => {
        if (window.YT && window.YT.Player) { clearInterval(interval); r(); }
      }, 100);
    });
  }

  isListeningActive = true;
  
  listenPlayer = new YT.Player('listen-yt-container', {
    height: '0',
    width: '0',
    playerVars: {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      playsinline: 1
    },
    events: {
      onReady: () => {
        isListenPlayerReady = true;
        listenPlayer.setVolume(listenVolume?.value ?? 100);
        btnStartListening.textContent = 'Listening';
        if (btnResyncAudio) btnResyncAudio.disabled = false;
        setListenStatus('Connected. Waiting for host playback.');
        if (currentSong) {
          listenPlayer.loadVideoById(currentSong.youtube_id);
          listenPlayer.pauseVideo();
        }
      },
      onError: (e) => {
        console.error('[Votify] Participant player error:', e.data);
        setListenStatus('Error loading audio. Will retry next song.', true);
      }
    }
  });
}

function setListenStatus(text, isError = false) {
  if (!listenStatus) return;
  listenStatus.textContent = text;
  listenStatus.style.color = isError ? '#f87171' : '';
}

function showPausedBanner(visible) {
  let banner = document.getElementById('paused-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'paused-banner';
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 9000;
      background: linear-gradient(135deg, rgba(124,58,237,0.95), rgba(6,182,212,0.95));
      backdrop-filter: blur(8px);
      color: white; text-align: center;
      padding: 14px 20px; font-weight: 600; font-size: 0.95rem;
      display: flex; align-items: center; justify-content: center; gap: 8px;
    `;
    banner.innerHTML = '⏸️ The host has paused this session. Adding songs is disabled until they return. Hang tight! 🎵';
    document.body.prepend(banner);
  }
  banner.style.display = visible ? 'flex' : 'none';

  // Disable search input when paused
  if (searchInput) searchInput.disabled = visible;
  if (skipBtn) skipBtn.disabled = visible;
  if (roomData?.mode === 'listen_together' && visible) {
    setListenStatus('Room paused. Audio will resume when the host returns.');
  }
}

// ── Identity ─────────────────────────────────────────────────
async function resolveIdentity(params) {
  const urlToken = params.get('token');
  const urlName  = params.get('name');
  if (urlToken && urlName) {
    participantToken = urlToken;
    displayName = urlName;
    isGuest = params.get('guest') !== '0';
    return;
  }

  const user = await getUser();
  if (user) {
    participantToken = user.id;
    // Use profile username if available, fallback to name from metadata
    const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).maybeSingle();
    displayName = profile?.username || user.user_metadata?.full_name || user.email.split('@')[0];
    isGuest = false;
    return;
  }

  const saved = localStorage.getItem('votify_p_name');
  if (saved) {
    participantToken = getOrCreateGuestToken();
    displayName = saved;
    isGuest = true;
    return;
  }

  return new Promise((resolve) => {
    identityModal.classList.remove('hidden');
    document.getElementById('identity-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const val = document.getElementById('p-identity-name').value.trim();
      if (!val) return;
      displayName = val;
      participantToken = getOrCreateGuestToken();
      isGuest = true;
      localStorage.setItem('votify_p_name', displayName);
      identityModal.classList.add('hidden');
      resolve();
    });
  });
}

// ── Queue ─────────────────────────────────────────────────────
async function refreshQueue() {
  try {
    const { data, error } = await supabase
      .from('queue')
      .select('*')
      .eq('room_id', roomData.id)
      .eq('played', false)
      .order('upvotes', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) throw error;
    queue = data || [];
    queue.sort((a, b) => {
      const netA = (a.upvotes || 0) - (a.downvotes || 0);
      const netB = (b.upvotes || 0) - (b.downvotes || 0);
      if (netB !== netA) return netB - netA;
      return new Date(a.created_at) - new Date(b.created_at);
    });
    renderQueue();
  } catch (err) {
    console.error('[Votify] Queue error:', err);
  }
}

function renderQueue() {
  // Exclude currentSong from queue list (shown as Now Playing)
  const upNext = currentSong ? queue.filter(s => s.id !== currentSong.id) : queue;
  if (queueBadge) queueBadge.textContent = upNext.length;

  if (upNext.length === 0) {
    queueEmpty.classList.remove('hidden');
    queueList.innerHTML = '';
    return;
  }

  queueEmpty.classList.add('hidden');

  queueList.innerHTML = upNext.map((song, i) => {
    const myVote   = getVoteForItem(song.id);
    const net      = (song.upvotes || 0) - (song.downvotes || 0);
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const scoreClass = net > 0 ? 'pos' : net < 0 ? 'neg' : '';

    return `
      <div class="queue-card glass-card" data-id="${song.id}">
        <span class="queue-card-rank ${rankClass}">${i + 1}</span>
        <img class="queue-card-thumb" src="${song.thumbnail_url}" alt="" loading="lazy" />
        <div class="queue-card-info">
          <div class="queue-card-title">${escapeHtml(song.title)}</div>
          <div class="queue-card-added">by ${escapeHtml(song.added_by || 'Unknown')}</div>
        </div>
        <div class="vote-controls">
          <button class="vote-btn ${myVote === 'up' ? 'voted-up' : ''}" data-id="${song.id}" data-action="up" ${roomIsPaused ? 'disabled' : ''}>
            <span class="vote-arrow">▲</span>
          </button>
          <span class="vote-score ${scoreClass}">${net}</span>
          <button class="vote-btn ${myVote === 'down' ? 'voted-down' : ''}" data-id="${song.id}" data-action="down" ${roomIsPaused ? 'disabled' : ''}>
            <span class="vote-arrow">▽</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  queueList.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', handleVote);
  });
}

// ── Voting ────────────────────────────────────────────────────
async function handleVote(e) {
  if (roomIsPaused) { showToast('Session is paused by host.', 'info'); return; }
  const btn    = e.currentTarget;
  const id     = btn.dataset.id;
  const action = btn.dataset.action;
  const myVote = getVoteForItem(id);

  btn.disabled = true;
  try {
    if (myVote === action) {
      await removeVote(id, participantToken);
    } else if (action === 'up') {
      await castUpvote(id, participantToken);
    } else {
      await castDownvote(id, participantToken);
    }
    await refreshQueue();
    if (syncChannel) syncChannel.send({ type: 'broadcast', event: 'queue_update', payload: {} });
  } catch (err) {
    showToast(err.message || 'Vote failed', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Skip ──────────────────────────────────────────────────────
async function handleSkipVote() {
  if (!currentSong || roomIsPaused) return;
  skipBtn.disabled = true;
  try {
    await submitSkipVote(roomData.id, currentSong.id, participantToken);
    showToast('Skip vote recorded!', 'success');
    updateSkipProgress();
    if (syncChannel) syncChannel.send({ type: 'broadcast', event: 'skip_update', payload: {} });
  } catch (err) {
    showToast(err.message || 'Already voted to skip', 'error');
    skipBtn.disabled = false;
  }
}

async function updateSkipProgress() {
  if (!currentSong || !skipText) return;
  const count = await getSkipVoteCount(roomData.id, currentSong.id);
  const threshold = Math.ceil(presenceCount / 2);
  skipText.textContent = `${count}/${threshold}`;
}

// ── Now Playing Sync ──────────────────────────────────────────
function syncWithPresence() {
  if (!syncChannel) return;
  const state = syncChannel.presenceState();
  const presences = Object.values(state).flat();
  const hosts = presences.filter(p => p.isHost);
  
  if (hosts.length > 0) {
    hosts.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const host = hosts[0];
    if (host.currentSong !== undefined) {
      updateNowPlaying(host.currentSong, host.updatedAt);
    }
  } else {
    refreshQueue();
  }
}

function updateNowPlaying(song, updatedAt = 0) {
  // Prevent older ghost presence objects from reverting the song
  if (updatedAt && updatedAt < lastSongUpdatedAt) return;
  if (updatedAt) lastSongUpdatedAt = updatedAt;
  else lastSongUpdatedAt = Date.now();

  if (!song) {
    nowPlayingMini.classList.add('hidden');
    currentSong = null;
    if (isListeningActive && isListenPlayerReady) listenPlayer.stopVideo();
    renderQueue();
    return;
  }
  const changed = currentSong?.id !== song.id;
  currentSong = song;
  nowPlayingMini.classList.remove('hidden');
  if (npmTitle) npmTitle.textContent = song.title;
  if (skipBtn) skipBtn.disabled = roomIsPaused;
  updateSkipProgress();

  if (changed && isListeningActive && isListenPlayerReady) {
    listenPlayer.loadVideoById(song.youtube_id);
    listenPlayer.pauseVideo(); // Wait for sync ping to play
    setListenStatus('Loaded next song. Waiting for host playback.');
  }

  if (changed) refreshQueue();
  else renderQueue();
}

// ── Realtime ──────────────────────────────────────────────────
function setupRealtime() {
  // Use module-level syncChannel (fixes the scope bug causing "Failed to add song")
  syncChannel = supabase.channel(`room-${roomCode}`);

  syncChannel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'queue', filter: `room_id=eq.${roomData.id}` }, () => {
      refreshQueue();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomData.id}` }, (payload) => {
      if (payload.new.status === 'ended' || payload.new.status === 'paused') {
        if (payload.new.status === 'ended') {
          showStatusModal('👋', 'Room Ended', 'The host has closed this session. Thanks for listening!');
          setTimeout(() => { window.location.replace('join.html'); }, 3000);
        } else {
          // Paused
          roomIsPaused = true;
          roomData.status = 'paused';
          showPausedBanner(true);
          showToast('Host has paused the session. 🎵', 'info');
        }
      } else if (payload.new.status === 'active') {
        // Host rejoined and reactivated
        roomIsPaused = false;
        roomData.status = 'active';
        showPausedBanner(false);
        if (roomData.mode === 'listen_together') setListenStatus('Connected. Waiting for host audio.');
        showToast('Host is back! Session resumed. 🎧', 'success');
        refreshQueue();
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_bans', filter: `room_id=eq.${roomData.id}` }, (payload) => {
      if (payload.new.participant_token === participantToken) {
        showStatusModal('🚫', 'Kicked', 'You have been removed from this room.');
        setTimeout(() => { window.location.replace('join.html'); }, 3000);
      }
    })
    .on('broadcast', { event: 'kick' }, (payload) => {
      if (payload.payload?.participant_token === participantToken) {
        showStatusModal('🚫', 'Kicked', 'You have been removed from this room.');
        setTimeout(() => { window.location.replace('join.html'); }, 3000);
      }
    })
    .on('broadcast', { event: 'queue_update' }, () => {
      refreshQueue();
    })
    .on('broadcast', { event: 'now_playing' }, ({ payload }) => {
      // Instant now-playing update via broadcast (much faster than presence alone)
      if (payload?.currentSong !== undefined) {
        updateNowPlaying(payload.currentSong, payload.updatedAt || Date.now());
      }
    })
    .on('broadcast', { event: 'room_status_update' }, ({ payload }) => {
      if (payload?.status === 'paused') {
        roomIsPaused = true;
        roomData.status = 'paused';
        showPausedBanner(true);
        if (isListeningActive && isListenPlayerReady) listenPlayer.pauseVideo();
        showToast('Host has paused the session. 🎵', 'info');
      } else if (payload?.status === 'active') {
        roomIsPaused = false;
        roomData.status = 'active';
        showPausedBanner(false);
        if (roomData.mode === 'listen_together') setListenStatus('Connected. Waiting for host audio.');
        showToast('Host is back! Session resumed. 🎧', 'success');
        refreshQueue();
      }
    })
    .on('broadcast', { event: 'sync_playback' }, ({ payload }) => {
      if (!isListeningActive || !isListenPlayerReady || !listenPlayer) return;
      if (payload.songId !== currentSong?.id) return;

      if (payload.isPlaying) {
        // Assume ~100ms network latency. Do NOT use Date.now() differences because 
        // host and participant system clocks are rarely perfectly synchronized.
        const expectedTime = payload.currentTime + 0.1;
        const myTime = listenPlayer.getCurrentTime() || 0;
        
        if (listenPlayer.getPlayerState() !== YT.PlayerState.PLAYING) {
           listenPlayer.playVideo();
           setListenStatus('Playing in sync with host.');
        }

        // Tighten drift threshold to 0.5s for better sync
        if (Math.abs(expectedTime - myTime) > 0.5) {
          listenPlayer.seekTo(expectedTime, true);
        }
      } else {
        if (listenPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
          listenPlayer.pauseVideo();
          setListenStatus('Host paused playback.');
        }
      }
    })
    .on('broadcast', { event: 'skip_update' }, () => {
      updateSkipProgress();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'skip_votes', filter: `room_id=eq.${roomData.id}` }, () => {
      updateSkipProgress();
    })
    .on('presence', { event: 'sync' }, () => {
      const state = syncChannel.presenceState();
      presenceCount = Object.keys(state).length;
      updateSkipProgress();
      
      const presences = Object.values(state).flat();
      const hosts = presences.filter(p => p.isHost);
      
      if (hosts.length > 0) {
        // Sort descending by updatedAt so we don't pick up a stale ghost connection
        hosts.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        const host = hosts[0];
        if (host.currentSong !== undefined) {
          updateNowPlaying(host.currentSong, host.updatedAt);
        }
      } else {
        refreshQueue();
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        reconnectBanner.classList.remove('visible');
        await syncChannel.track({ token: participantToken, name: displayName, isHost: false });
        
        // Retry presence sync — presence state may not be immediately available
        // Attempt at 500ms, 1.5s, 3s to handle slow host presence hydration
        const trySyncPresence = (attempt = 0) => {
          syncWithPresence();
          if (attempt < 3 && !currentSong) {
            setTimeout(() => trySyncPresence(attempt + 1), attempt === 0 ? 1000 : 1500);
          }
        };
        setTimeout(() => trySyncPresence(), 500);
      } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        reconnectBanner.classList.add('visible');
      }
    });
}

// ── Search ────────────────────────────────────────────────────
const PIPED_INSTANCES = [
  'https://api.piped.private.coffee',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.syncpundit.io',
];

const INVIDIOUS_INSTANCES = [
  'https://inv.thepixora.com',
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
  'https://invidious.jing.rocks',
];

async function searchYouTube(query) {
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${instance}/search?q=${encodeURIComponent(query)}&filter=videos`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.items?.length) {
        return data.items.filter(v => v.type === 'stream').slice(0, 8).map(v => ({
          youtube_id: (v.url || '').replace('/watch?v=', '') || v.videoId,
          title: v.title,
          thumbnail_url: v.thumbnail || `https://i.ytimg.com/vi/${(v.url || '').replace('/watch?v=', '')}/mqdefault.jpg`,
          author: v.uploaderName || '',
        }));
      }
    } catch { continue; }
  }
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        return data.filter(v => v.type === 'video').slice(0, 8).map(v => ({
          youtube_id: v.videoId,
          title: v.title,
          thumbnail_url: v.videoThumbnails?.find(t => t.quality === 'medium')?.url
            || v.videoThumbnails?.[0]?.url
            || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
          author: v.author || '',
        }));
      }
    } catch { continue; }
  }
  throw new Error('All search instances failed');
}

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  if (q) {
    searchClear.classList.remove('hidden');
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => performSearch(q), 400);
  } else {
    searchClear.classList.add('hidden');
    resultsSection.classList.add('hidden');
    resultsList.innerHTML = '';
  }
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.classList.add('hidden');
  resultsSection.classList.add('hidden');
  resultsList.innerHTML = '';
  searchInput.focus();
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimeout);
    performSearch(searchInput.value.trim());
  }
});

async function performSearch(q) {
  if (!q || q.length < 2) return;
  if (roomIsPaused) { showToast('Session is paused — search is disabled.', 'info'); return; }
  searchSpinner.classList.remove('hidden');
  resultsSection.classList.remove('hidden');
  resultsList.innerHTML = `
    ${[1,2,3,4].map(() => `
      <div class="result-skeleton">
        <div class="skeleton skeleton-thumb"></div>
        <div class="skeleton-info">
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text short"></div>
        </div>
      </div>
    `).join('')}
  `;

  try {
    const results = await searchYouTube(q);
    if (!results.length) {
      resultsList.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:var(--space-lg);">No results found</p>`;
      return;
    }
    resultsList.innerHTML = results.map(r => `
      <div class="result-card glass-card-hover"
           data-ytid="${r.youtube_id}"
           data-title="${escapeAttr(r.title)}"
           data-thumb="${escapeAttr(r.thumbnail_url)}">
        <img class="result-thumb" src="${r.thumbnail_url}" alt="" loading="lazy"
             onerror="this.src='https://i.ytimg.com/vi/${r.youtube_id}/mqdefault.jpg'" />
        <div class="result-info">
          <div class="result-title">${escapeHtml(r.title)}</div>
          <div class="result-author">${escapeHtml(r.author)}</div>
        </div>
        <div class="result-add-icon">➕</div>
      </div>
    `).join('');

    resultsList.querySelectorAll('.result-card').forEach(card => {
      card.addEventListener('click', () => addSong(card));
    });

  } catch (err) {
    resultsList.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:var(--space-lg);">Search is down right now — try again in a sec! 🎵</p>`;
  } finally {
    searchSpinner.classList.add('hidden');
  }
}

async function addSong(card) {
  if (roomIsPaused) { showToast('Session is paused by host. Hang tight! 🎵', 'info'); return; }
  if (card.classList.contains('adding')) return;
  card.classList.add('adding');
  card.querySelector('.result-add-icon').textContent = '⏳';

  try {
    const { data, error } = await supabase.from('queue').insert({
      room_id: roomData.id,
      youtube_id: card.dataset.ytid,
      title: card.dataset.title,
      thumbnail_url: card.dataset.thumb,
      added_by: displayName,
      upvotes: 0,
      downvotes: 0,
    }).select();

    if (error) throw error;

    // Automatically upvote the song they just added
    await castUpvote(data[0].id, participantToken);
    await refreshQueue();

    // Broadcast update to all other participants
    if (syncChannel) syncChannel.send({ type: 'broadcast', event: 'queue_update', payload: {} });

    card.querySelector('.result-add-icon').textContent = '✅';
    setTimeout(() => {
      searchInput.value = '';
      searchClear.classList.add('hidden');
      resultsSection.classList.add('hidden');
      resultsList.innerHTML = '';
    }, 600);
  } catch (err) {
    // Show a specific message if room is paused at DB level
    if (err.message?.includes('row-level security') || err.message?.includes('violates')) {
      showToast('This room is currently paused. Songs cannot be added.', 'info');
    } else {
      console.error('[Votify] addSong error:', err);
    }
    card.classList.remove('adding');
    card.querySelector('.result-add-icon').textContent = '➕';
  }
}

// ── Skip button ───────────────────────────────────────────────
if (skipBtn) skipBtn.addEventListener('click', handleSkipVote);

// ── Utils ─────────────────────────────────────────────────────
function showStatusModal(icon, title, desc) {
  document.getElementById('status-icon').textContent = icon;
  document.getElementById('status-title').textContent = title;
  document.getElementById('status-desc').textContent = desc;
  statusModal.style.position = 'fixed';
  statusModal.style.inset = '0';
  statusModal.style.zIndex = '99999';
  statusModal.style.backdropFilter = 'blur(12px)';
  statusModal.style.background = 'rgba(0,0,0,0.75)';
  statusModal.style.display = 'flex';
  statusModal.style.alignItems = 'center';
  statusModal.style.justifyContent = 'center';
  statusModal.classList.remove('hidden');
}

function showToast(msg, type = 'info') {
  while (toastContainer.children.length >= 2) {
    toastContainer.firstElementChild.remove();
  }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  toastContainer.appendChild(t);
  setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 300); }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Start
init();
