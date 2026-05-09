/* ============================================================
   🎧 VOTIFY — Host Screen Logic (V2)
   YouTube Player + Room Scoping + Presence Broadcasting
   ============================================================ */

import { supabase } from './supabase-config.js';
import { requireAuth, getProfile } from './auth.js';
import { getRoomForHost, pauseRoom, activateRoom, getRoomParticipants, kickParticipant, getBannedParticipants, unbanParticipant } from './rooms.js';
import { ListenTogetherConnection, isListenTogetherConfigured } from './webrtc.js';

// ── State ──
let player = null;
let currentSong = null;
let isPlayerReady = false;
let queue = [];
let roomCode = null;
let roomData = null;
let syncChannel = null;
let presenceCount = 0;
let isPinVisible = false;
let listenConnection = null;
let hostIdentity = null;

// ── DOM Elements ──
const nowPlayingSection  = document.getElementById('now-playing-section');
const nowPlayingTitle    = document.getElementById('now-playing-title');
const idleState          = document.getElementById('idle-state');
const queueList          = document.getElementById('queue-list');
const queueEmpty         = document.getElementById('queue-empty');
const statQueue          = document.getElementById('stat-queue');
const statPlayed         = document.getElementById('stat-played');
const toastContainer     = document.getElementById('toast-container');
const reconnectBanner    = document.getElementById('reconnect-banner');
const pBadge             = document.getElementById('p-badge');
const participantsList   = document.getElementById('participants-list');
const listenHostStatus   = null;
const btnStartListenAudio = document.getElementById('btn-start-listen-audio');

// ── Initialization ───────────────────────────────────────────
async function init() {
  // 1. Auth Guard
  const session = await requireAuth();
  if (!session) return;
  hostIdentity = session.user.id;

  // 2. Room Context
  const params = new URLSearchParams(window.location.search);
  roomCode = params.get('room')?.toUpperCase();

  if (!roomCode) {
    window.location.replace('home.html');
    return;
  }

  roomData = await getRoomForHost(roomCode);
  if (!roomData) {
    showToast('Room not found or you are not the host.', 'error');
    setTimeout(() => window.location.replace('home.html'), 2000);
    return;
  }

  // 3. Update UI with Room Data
  document.getElementById('display-room-name').textContent = roomData.name;
  document.getElementById('display-room-code').textContent = roomData.code;
  
  if (roomData.pin) {
    document.getElementById('pin-reveal-row')?.classList.remove('hidden');
    document.getElementById('display-room-pin').textContent = '••••';
  }

  // 4. QR Code
  generateQRCode();

  // 4.5 Listen Together controls
  setupListenTogetherHost();

  // 5. YouTube Player
  initPlayer();

  // 6. Initial Data
  await refreshQueue();
  await refreshPlayedCount();

  // 7. If room was paused, reactivate it before publishing host presence.
  if (roomData.status === 'paused') {
    await activateRoom(roomData.id);
    roomData.status = 'active';
    showToast('Room reactivated! Participants can now join again. 🎧', 'success');
  } else {
    showToast('Host console active 🎧', 'success');
  }

  // 8. Realtime & Presence
  setupRealtime();

  // 9. Visualizer
  initVisualizer();
}

function setupListenTogetherHost() {
  if (roomData.mode !== 'listen_together') return;

  btnStartListenAudio?.classList.remove('hidden');
  if (!isListenTogetherConfigured()) {
    if (btnStartListenAudio) btnStartListenAudio.disabled = true;
    showToast('Add VITE_LIVEKIT_URL and deploy livekit-token to enable audio.', 'error');
    return;
  }

  listenConnection = new ListenTogetherConnection({
    roomCode,
    participantId: hostIdentity,
    displayName: 'Host',
    isHost: true,
    onStatus: updateListenHostStatus,
    onParticipantCount: (count) => {
    },
    onQuality: (quality) => {
    },
  });

  btnStartListenAudio?.addEventListener('click', startListenTogetherAudio);
}

async function startListenTogetherAudio() {
  if (!listenConnection) return;
  btnStartListenAudio.disabled = true;
  btnStartListenAudio.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>'; // loading
  try {
    await listenConnection.connect();
    await listenConnection.publishTabAudio();
    btnStartListenAudio.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'; // pause icon
    showToast('Listen Together audio is live.', 'success');
  } catch (err) {
    console.error('[Votify] Listen Together host error:', err);
    btnStartListenAudio.disabled = false;
    btnStartListenAudio.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>'; // play icon
    showToast(err.message || 'Could not start Listen Together audio.', 'error');
  }
}

function updateListenHostStatus(status) {
  if (status === 'audio-ended' && btnStartListenAudio) {
    btnStartListenAudio.disabled = false;
    btnStartListenAudio.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>'; // play icon
  }
}

function setListenHostStatus(text, isError = false) {
}

// ── QR Code ──────────────────────────────────────────────────
function generateQRCode() {
  const qrContainer = document.getElementById('qr-code');
  const qrUrlEl     = document.getElementById('qr-url');
  const baseUrl     = import.meta.env.VITE_DEPLOYED_URL || window.location.origin;
  const joinUrl     = `${baseUrl}/join.html?room=${roomCode}`;
  const displayUrl  = joinUrl.replace(/^https?:\/\//, '');

  // ── URL Display + Click-to-Copy ──
  qrUrlEl.textContent = displayUrl;
  qrUrlEl.style.cursor = 'pointer';
  qrUrlEl.title = 'Click to copy link';
  qrUrlEl.addEventListener('click', () => {
    navigator.clipboard.writeText(joinUrl).then(() => {
      const prev = qrUrlEl.textContent;
      qrUrlEl.textContent = '✅ Copied!';
      qrUrlEl.style.color = '#86efac';
      setTimeout(() => {
        qrUrlEl.textContent = prev;
        qrUrlEl.style.color = '';
      }, 2000);
    });
  });

  // ── QR Code — use Google Charts API (instant, no library dependency) ──
  qrContainer.innerHTML = '';
  const size = 180;
  const img = document.createElement('img');
  img.width  = size;
  img.height = size;
  img.alt    = 'QR Code';
  img.style.cssText = `
    border-radius: 8px;
    display: block;
    background: #fff;
    padding: 8px;
    box-sizing: border-box;
  `;
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(joinUrl)}&bgcolor=ffffff&color=0a0a0f&margin=1`;
  img.onerror = () => {
    // Fallback to QRCode.js library if the API fails (offline scenarios)
    img.remove();
    if (typeof QRCode !== 'undefined') {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'background:#fff;padding:8px;border-radius:8px;display:inline-block;';
      qrContainer.appendChild(wrapper);
      new QRCode(wrapper, {
        text: joinUrl,
        width: size - 16,
        height: size - 16,
        colorDark: '#0a0a0f',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
    } else {
      qrContainer.innerHTML = `<p style="color:var(--text-muted);font-size:0.75rem;padding:8px;text-align:center;">QR unavailable</p>`;
    }
  };
  qrContainer.appendChild(img);
}

// ── YouTube IFrame Player ────────────────────────────────────
async function initPlayer() {
  await window.__ytReady;
  player = new YT.Player('yt-player', {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 1,
      controls: 1,
      modestbranding: 1,
      rel: 0,
      fs: 1,
      iv_load_policy: 3,
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    },
  });
}

function onPlayerReady() {
  isPlayerReady = true;
  playNextSong();
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.ENDED) {
    markCurrentAsPlayed();
  }
}

function onPlayerError(event) {
  console.error('[Votify] Player error:', event.data);
  showToast('Playback error — skipping...', 'error');
  markCurrentAsPlayed();
}

// ── Playback Logic ───────────────────────────────────────────
async function playNextSong() {
  if (!isPlayerReady) return;

  try {
    // Fetch top song by Net Score (upvotes - downvotes)
    const { data, error } = await supabase
      .from('queue')
      .select('*')
      .eq('room_id', roomData.id)
      .eq('played', false)
      .order('upvotes', { ascending: false }) // We'll add net_score column in Phase 2 or use raw logic
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) throw error;

    if (data && data.length > 0) {
      const song = data[0];
      currentSong = song;

      // UI
      nowPlayingSection.classList.add('active');
      idleState.classList.add('hidden');
      nowPlayingTitle.textContent = song.title;

      player.loadVideoById(song.youtube_id);
      // Update Presence & Signaling after local state is fully committed.
      await broadcastState();
      await refreshQueue();
    } else {
      currentSong = null;
      nowPlayingSection.classList.remove('active');
      idleState.classList.remove('hidden');
      if (player?.stopVideo) player.stopVideo();
      await broadcastState();
      await refreshQueue();
    }
  } catch (err) {
    showToast('Failed to load next song', 'error');
  }
}

async function markCurrentAsPlayed() {
  if (!currentSong) return;
  try {
    await supabase.from('queue').update({ played: true }).eq('id', currentSong.id);
    currentSong = null;
    await refreshPlayedCount();
    setTimeout(playNextSong, 1000);
  } catch (err) {
    showToast('Failed to update queue', 'error');
  }
}

// ── Queue Display ────────────────────────────────────────────
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
    renderQueueList();
  } catch (err) {
    console.error(err);
  }
}

function renderQueueList() {
  const upNext = currentSong ? queue.filter(s => s.id !== currentSong.id) : queue;
  if (statQueue) statQueue.textContent = upNext.length;

  if (upNext.length === 0) {
    queueEmpty.classList.remove('hidden');
    queueList.querySelectorAll('.queue-song').forEach(el => el.remove());
    return;
  }

  queueEmpty.classList.add('hidden');

  queueList.innerHTML = upNext.map((song, i) => {
    const score = (song.upvotes || 0) - (song.downvotes || 0);
    const scoreClass = score > 0 ? 'pos' : score < 0 ? 'neg' : 'neutral';
    const rankClass = i === 0 ? 'top-1' : i === 1 ? 'top-2' : i === 2 ? 'top-3' : '';
    return `
      <div class="queue-song glass-card" data-id="${song.id}">
        <span class="queue-song-rank ${rankClass}">${i + 1}</span>
        <img class="queue-song-thumb" src="${song.thumbnail_url}" alt="" loading="lazy" />
        <div class="queue-song-info">
          <div class="queue-song-title">${escapeHtml(song.title)}</div>
        </div>
        <div class="queue-song-score ${scoreClass}">${score > 0 ? '+' : ''}${score}</div>
        <button class="btn-delete-track" data-id="${song.id}" title="Remove">✕</button>
      </div>
    `;
  }).join('');

  queueList.querySelectorAll('.btn-delete-track').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await showConfirm('Remove Song', 'Remove this song from the queue?')) {
        await supabase.from('queue').update({ played: true }).eq('id', btn.dataset.id);
      }
    });
  });
}

async function refreshPlayedCount() {
  const { count } = await supabase
    .from('queue')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', roomData.id)
    .eq('played', true);
  if (statPlayed) statPlayed.textContent = count || 0;
  // If history tab is active, refresh it too
  if (document.getElementById('history-list') && !document.getElementById('history-list').classList.contains('hidden')) {
    await refreshHistory();
  }
}

async function refreshHistory() {
  const historyList = document.getElementById('history-list');
  if (!historyList) return;
  const { data } = await supabase
    .from('queue')
    .select('*')
    .eq('room_id', roomData.id)
    .eq('played', true)
    .order('created_at', { ascending: false });
  const songs = data || [];
  if (!songs.length) {
    historyList.innerHTML = '<div class="queue-empty"><p>No songs played yet</p></div>';
    return;
  }
  historyList.innerHTML = songs.map((song, i) => `
    <div class="queue-song glass-card" style="opacity:0.65;">
      <span class="queue-song-rank" style="color:var(--text-muted);">${i + 1}</span>
      <img class="queue-song-thumb" src="${song.thumbnail_url}" alt="" loading="lazy" />
      <div class="queue-song-info">
        <div class="queue-song-title">${escapeHtml(song.title)}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">Added by ${escapeHtml(song.added_by || 'Unknown')}</div>
      </div>
      <span style="font-size:0.75rem;color:var(--text-muted);">Played</span>
    </div>
  `).join('');
}

// ── Realtime & Presence ──────────────────────────────────────
function setupRealtime() {
  syncChannel = supabase.channel(`room-${roomCode}`);

  syncChannel
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'queue', 
      filter: `room_id=eq.${roomData.id}` 
    }, (payload) => {
      refreshQueue();
      if (!currentSong && payload.eventType === 'INSERT') playNextSong();
    })
    .on('presence', { event: 'sync' }, () => {
      const state = syncChannel.presenceState();
      presenceCount = Object.keys(state).length;
      if (pBadge) pBadge.textContent = presenceCount;
      refreshParticipants();
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        reconnectBanner.classList.remove('visible');
        await broadcastState();
        await broadcastRoomStatus(roomData.status);
      } else {
        reconnectBanner.classList.add('visible');
      }
    });

  // Fallback broadcast listener for skip votes
  syncChannel.on('broadcast', { event: 'skip_update' }, async () => {
    const { count } = await supabase
      .from('skip_votes')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', roomData.id)
      .eq('queue_item_id', currentSong?.id);
    
    const threshold = Math.ceil(presenceCount / 2);
    if (count >= threshold && currentSong) {
      showToast('Skip threshold reached!', 'info');
      markCurrentAsPlayed();
    }
  });

  // Skip Votes Listener
  supabase
    .channel(`skips-${roomData.id}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'skip_votes',
      filter: `room_id=eq.${roomData.id}`
    }, async () => {
      const { count } = await supabase
        .from('skip_votes')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', roomData.id)
        .eq('queue_item_id', currentSong?.id);
      
      const threshold = Math.ceil(presenceCount / 2);
      if (count >= threshold && currentSong) {
        showToast('Skip threshold reached! ⏭️', 'info');
        markCurrentAsPlayed();
      }
    })
    .subscribe();
}

async function broadcastState() {
  if (syncChannel) {
    // Presence: persistent state for new joiners
    await syncChannel.track({
      isHost: true,
      currentSong,
      roomStatus: roomData.status
    });
    // Broadcast: instant delivery for active participants
    syncChannel.send({
      type: 'broadcast',
      event: 'now_playing',
      payload: { currentSong }
    });
  }
}

async function broadcastRoomStatus(status) {
  if (!syncChannel) return;
  await syncChannel.send({
    type: 'broadcast',
    event: 'room_status_update',
    payload: { status }
  });
}

// ── Participants ─────────────────────────────────────────────
async function refreshParticipants() {
  const list = await getRoomParticipants(roomData.id);
  const banned = await getBannedParticipants(roomData.id);
  
  // Prepend Host manually
  const { data: { session } } = await supabase.auth.getSession();
  const profile = await getProfile(session?.user?.id);
  const hostName = profile?.username || session?.user?.email?.split('@')[0] || 'Host';

  // Active participants tab
  const activeTabContent = `
    <div class="p-row">
      <div class="p-row-info">
        <span class="p-row-name">${escapeHtml(hostName)} <span style="color:var(--primary); font-size:0.8rem; margin-left:4px;">(Host)</span></span>
        <span class="p-row-meta">Authenticated</span>
      </div>
    </div>
  ` + list.map(p => `
    <div class="p-row">
      <div class="p-row-info">
        <span class="p-row-name">${escapeHtml(p.display_name || 'Guest')}</span>
        <span class="p-row-meta">${p.is_guest ? 'Guest' : 'Authenticated'}</span>
      </div>
      <button class="btn-kick" data-token="${p.participant_token}" data-name="${escapeHtml(p.display_name || 'Guest')}">Kick</button>
    </div>
  `).join('');

  // Banned participants tab
  const bannedTabContent = banned.length === 0
    ? '<p style="color:var(--text-muted);text-align:center;padding:16px;font-size:0.85rem;">No banned users</p>'
    : banned.map(b => `
      <div class="p-row">
        <div class="p-row-info">
          <span class="p-row-name" style="color:#f87171;">🚫 ${escapeHtml(b.display_name || 'Unknown participant')}</span>
          <span class="p-row-meta">Banned ${new Date(b.banned_at).toLocaleDateString()}</span>
        </div>
        <button class="btn-unban" data-token="${b.participant_token}">Unban</button>
      </div>
    `).join('');

  participantsList.innerHTML = `
    <div class="drawer-tabs">
      <button class="drawer-tab active" id="dtab-active">Active (${list.length + 1})</button>
      <button class="drawer-tab" id="dtab-banned">Banned (${banned.length})</button>
    </div>
    <div id="dpanel-active" class="drawer-panel">${activeTabContent}</div>
    <div id="dpanel-banned" class="drawer-panel hidden">${bannedTabContent}</div>
  `;

  // Drawer tab switching
  document.getElementById('dtab-active')?.addEventListener('click', () => {
    document.getElementById('dtab-active').classList.add('active');
    document.getElementById('dtab-banned').classList.remove('active');
    document.getElementById('dpanel-active').classList.remove('hidden');
    document.getElementById('dpanel-banned').classList.add('hidden');
  });
  document.getElementById('dtab-banned')?.addEventListener('click', () => {
    document.getElementById('dtab-banned').classList.add('active');
    document.getElementById('dtab-active').classList.remove('active');
    document.getElementById('dpanel-banned').classList.remove('hidden');
    document.getElementById('dpanel-active').classList.add('hidden');
  });

  participantsList.querySelectorAll('.btn-kick').forEach(btn => {
    btn.addEventListener('click', async () => {
      const nameToKick = btn.dataset.name || btn.dataset.token;
      if (await showConfirm('Kick Participant', `Kick "${nameToKick}" from the room?`)) {
        await kickParticipant(roomData.id, btn.dataset.token, btn.dataset.name);
        if (syncChannel) {
          syncChannel.send({ type: 'broadcast', event: 'kick', payload: { participant_token: btn.dataset.token } });
        }
        showToast('Participant kicked.', 'info');
        refreshParticipants();
      }
    });
  });

  participantsList.querySelectorAll('.btn-unban').forEach(btn => {
    btn.addEventListener('click', async () => {
      await unbanParticipant(roomData.id, btn.dataset.token);
      showToast('Participant unbanned.', 'success');
      refreshParticipants();
    });
  });
}

// ── UI Events ────────────────────────────────────────────────
document.getElementById('btn-skip-track').addEventListener('click', () => {
  if (currentSong) markCurrentAsPlayed();
});

document.getElementById('btn-clear-queue').addEventListener('click', async () => {
  if (await showConfirm('Clear Queue', 'Clear all upcoming songs?')) {
    await supabase.from('queue').update({ played: true }).eq('room_id', roomData.id).eq('played', false);
    showToast('Queue cleared', 'info');
  }
});

// Queue / History tab switching
document.getElementById('tab-queue')?.addEventListener('click', () => {
  document.getElementById('tab-queue').classList.add('active');
  document.getElementById('tab-history').classList.remove('active');
  document.getElementById('queue-list').classList.remove('hidden');
  document.getElementById('history-list').classList.add('hidden');
});

document.getElementById('tab-history')?.addEventListener('click', async () => {
  document.getElementById('tab-history').classList.add('active');
  document.getElementById('tab-queue').classList.remove('active');
  document.getElementById('queue-list').classList.add('hidden');
  document.getElementById('history-list').classList.remove('hidden');
  await refreshHistory();
});


document.getElementById('btn-toggle-pin')?.addEventListener('click', () => {
  isPinVisible = !isPinVisible;
  const pinEl     = document.getElementById('display-room-pin');
  const eyeOpen   = document.getElementById('eye-open');
  const eyeClosed = document.getElementById('eye-closed');
  pinEl.textContent = isPinVisible ? roomData.pin : '••••';
  eyeOpen.classList.toggle('hidden', isPinVisible);
  eyeClosed.classList.toggle('hidden', !isPinVisible);
});

let isBlurred = false;
document.getElementById('btn-blur-player')?.addEventListener('click', () => {
  isBlurred = !isBlurred;
  document.getElementById('player-blur-overlay').classList.toggle('active', isBlurred);
  // No toast — silent toggle
});

document.getElementById('btn-end-session').addEventListener('click', async () => {
  if (await showConfirm('Leave Session', 'Save and pause the room? Participants will see a hold message until you rejoin.')) {
    try {
      await listenConnection?.disconnect();
      await pauseRoom(roomData.id);
      roomData.status = 'paused';
      // Broadcast after the DB write so participants and persisted state agree.
      if (syncChannel) {
        await syncChannel.send({ type: 'broadcast', event: 'room_status_update', payload: { status: 'paused' } });
        await new Promise(r => setTimeout(r, 300)); // let broadcast propagate
      }
    } catch (err) {
      console.error('[Votify] pauseRoom failed:', err);
      showToast('Failed to pause the room. Please try again.', 'error');
      return;
    }
    window.location.replace('home.html');
  }
});

document.getElementById('btn-show-participants')?.addEventListener('click', () => {
  document.getElementById('participants-drawer').classList.remove('hidden');
  refreshParticipants();
});

document.getElementById('btn-close-drawer')?.addEventListener('click', () => {
  document.getElementById('participants-drawer').classList.add('hidden');
});

// Click outside drawer to close
document.getElementById('participants-drawer')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.add('hidden');
  }
});

// ── Visualizer ───────────────────────────────────────────────
function initVisualizer() {
  const canvas = document.getElementById('visualizer-canvas');
  const ctx = canvas.getContext('2d');
  const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
  window.addEventListener('resize', resize);
  resize();

  let time = 0;
  function draw() {
    requestAnimationFrame(draw);
    time += 0.01;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bars = 60;
    const barWidth = canvas.width / bars;
    const midY = canvas.height / 2;
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(124, 58, 237, 0.4)');
    gradient.addColorStop(1, 'rgba(6, 182, 212, 0.4)');
    ctx.fillStyle = gradient;
    for (let i = 0; i < bars; i++) {
      let noise = Math.sin(time + i * 0.2) * Math.cos(time * 0.5 + i * 0.1);
      let amp = currentSong ? 200 : 40;
      let h = Math.abs(noise) * amp + 10;
      ctx.fillRect(i * barWidth, midY - h, barWidth - 4, h * 2);
    }
  }
  draw();
}

// ── Confirm Modal ────────────────────────────────────────────
function showConfirm(title, msg) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = msg;
    modal.classList.add('visible');
    const cleanup = (res) => {
      modal.classList.remove('visible');
      document.getElementById('modal-confirm').onclick = null;
      document.getElementById('modal-cancel').onclick = null;
      resolve(res);
    };
    document.getElementById('modal-confirm').onclick = () => cleanup(true);
    document.getElementById('modal-cancel').onclick = () => cleanup(false);
  });
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
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Start
init();
