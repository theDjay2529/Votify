/* ============================================================
   🎧 VOTIFY — Host Screen Logic
   YouTube IFrame Player + Supabase Realtime + QR Code
   ============================================================ */

import { supabase } from './supabase-config.js';

// ── State ──
let player = null;
let currentSong = null;
let isPlayerReady = false;
let queue = [];

// ── DOM Elements ──
const nowPlayingSection = document.getElementById('now-playing-section');
const nowPlayingTitle = document.getElementById('now-playing-title');
const idleState = document.getElementById('idle-state');
const queueList = document.getElementById('queue-list');
const queueEmpty = document.getElementById('queue-empty');
const queueCount = document.getElementById('queue-count');
const statQueue = document.getElementById('stat-queue');
const statPlayed = document.getElementById('stat-played');
const toastContainer = document.getElementById('toast-container');
const reconnectBanner = document.getElementById('reconnect-banner');

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

// ── QR Code Generation ──
// Set this to your deployed Netlify/Vercel URL so phones can always reach it.
// If empty, falls back to current window location (works for localhost on same Wi-Fi).
const DEPLOYED_URL = 'https://votify-vibeathon.netlify.app';

function generateQRCode() {
  const qrContainer = document.getElementById('qr-code');
  const qrUrlDisplay = document.getElementById('qr-url');

  // Use deployed URL if set, otherwise fall back to current origin
  const baseUrl = DEPLOYED_URL || window.location.origin;
  const participantUrl = `${baseUrl}/participant.html`;

  qrUrlDisplay.textContent = participantUrl;

  // Clear any existing QR code
  qrContainer.innerHTML = '';

  // Generate with qrcode.js
  if (typeof QRCode !== 'undefined') {
    new QRCode(qrContainer, {
      text: participantUrl,
      width: 180,
      height: 180,
      colorDark: '#ffffff',
      colorLight: 'transparent',
      correctLevel: QRCode.CorrectLevel.M,
    });
  } else {
    qrContainer.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;">QR library not loaded</p>';
  }
}

// ── YouTube IFrame Player ──
// We use window.__ytReady (a promise set in host.html) to handle the
// race condition between the YouTube API and ES module loading.
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
      iv_load_policy: 3, // hide annotations
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
  console.log('[Votify] YouTube player ready');
  playNextSong();
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.ENDED) {
    console.log('[Votify] Song ended, marking as played...');
    markCurrentAsPlayed();
  }
}

function onPlayerError(event) {
  console.error('[Votify] Player error:', event.data);
  showToast('Playback error — skipping to next song...', 'error');
  // Skip errored song
  markCurrentAsPlayed();
}

// ── Playback Logic ──
async function playNextSong() {
  if (!isPlayerReady) return;

  try {
    const { data, error } = await supabase
      .from('queue')
      .select('*')
      .eq('played', false)
      .order('votes', { ascending: false })
      .limit(1);

    if (error) throw error;

    if (data && data.length > 0) {
      const song = data[0];
      currentSong = song;

      // Show player, hide idle
      nowPlayingSection.classList.add('active');
      idleState.classList.add('hidden');

      // Update title
      nowPlayingTitle.textContent = song.title;

      // Load and play
      player.loadVideoById(song.youtube_id);

      console.log(`[Votify] Now playing: ${song.title}`);
    } else {
      // No songs — show idle state
      currentSong = null;
      nowPlayingSection.classList.remove('active');
      idleState.classList.remove('hidden');

      if (player && typeof player.stopVideo === 'function') {
        player.stopVideo();
      }
    }
  } catch (err) {
    console.error('[Votify] Error fetching next song:', err);
    showToast('Failed to load next song', 'error');
  }
}

async function markCurrentAsPlayed() {
  if (!currentSong) return;

  try {
    const { error } = await supabase
      .from('queue')
      .update({ played: true })
      .eq('id', currentSong.id);

    if (error) throw error;

    currentSong = null;
    // Small delay before playing next
    setTimeout(() => playNextSong(), 1000);
  } catch (err) {
    console.error('[Votify] Error marking song as played:', err);
    showToast('Failed to update queue', 'error');
  }
}

// ── Queue Display ──
async function refreshQueueDisplay() {
  try {
    // Fetch unplayed songs sorted by votes
    const { data: unplayed, error: err1 } = await supabase
      .from('queue')
      .select('*')
      .eq('played', false)
      .order('votes', { ascending: false });

    if (err1) throw err1;

    // Fetch played count
    const { count: playedCount, error: err2 } = await supabase
      .from('queue')
      .select('*', { count: 'exact', head: true })
      .eq('played', true);

    if (err2) throw err2;

    queue = unplayed || [];

    // Update stats
    statQueue.textContent = queue.length;
    statPlayed.textContent = playedCount || 0;
    queueCount.textContent = queue.length;

    // Filter out currently playing song for the "Up Next" list
    const upNext = currentSong
      ? queue.filter((s) => s.id !== currentSong.id)
      : queue;

    // Render queue
    if (upNext.length === 0) {
      queueEmpty.classList.remove('hidden');
      queueList.querySelectorAll('.queue-song').forEach((el) => el.remove());
    } else {
      queueEmpty.classList.add('hidden');

      // Clear existing songs
      queueList.querySelectorAll('.queue-song').forEach((el) => el.remove());

      upNext.forEach((song, index) => {
        const rankClass = index < 3 ? `top-${index + 1}` : '';
        const card = document.createElement('div');
        card.className = 'queue-song';
        card.style.animationDelay = `${index * 0.05}s`;
        card.innerHTML = `
          <span class="queue-song-rank ${rankClass}">${index + 1}</span>
          <img
            class="queue-song-thumb"
            src="${song.thumbnail_url || ''}"
            alt=""
            onerror="this.style.display='none'"
          />
          <div class="queue-song-info">
            <div class="queue-song-title" title="${song.title}">${song.title}</div>
          </div>
          <div class="queue-song-votes">
            <span class="arrow">▲</span> ${song.votes}
          </div>
        `;
        queueList.appendChild(card);
      });
    }
  } catch (err) {
    console.error('[Votify] Error refreshing queue:', err);
  }
}

// ── Supabase Realtime ──
function setupRealtime() {
  const channel = supabase
    .channel('host-queue-updates')
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

        // If no song is playing and a new song was inserted, play it
        if (!currentSong && payload.eventType === 'INSERT') {
          playNextSong();
        }
      }
    )
    .subscribe((status) => {
      console.log('[Votify] Realtime status:', status);
      if (status === 'SUBSCRIBED') {
        reconnectBanner.classList.remove('visible');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reconnectBanner.classList.add('visible');
        showToast('Connection lost — attempting to reconnect...', 'error');
        // Retry after 3 seconds
        setTimeout(() => {
          channel.subscribe();
        }, 3000);
      }
    });
}

// ── PIN Gate ──
// Change this PIN to whatever you want. Only the host needs to know it.
const HOST_PIN = '696969';

const pinGate = document.getElementById('pin-gate');
const pinInput = document.getElementById('pin-input');
const pinSubmit = document.getElementById('pin-submit');
const pinError = document.getElementById('pin-error');
const hostLayout = document.getElementById('host-layout');

function checkPinAuth() {
  return sessionStorage.getItem('votify_host_auth') === 'true';
}

function handlePinSubmit() {
  const entered = pinInput.value.trim();
  if (entered === HOST_PIN) {
    sessionStorage.setItem('votify_host_auth', 'true');
    pinGate.classList.add('hidden');
    hostLayout.style.display = '';
    init();
  } else {
    pinInput.classList.add('error');
    pinError.classList.remove('hidden');
    pinInput.value = '';
    setTimeout(() => {
      pinInput.classList.remove('error');
    }, 400);
    pinInput.focus();
  }
}

pinSubmit.addEventListener('click', handlePinSubmit);
pinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handlePinSubmit();
  // Hide error when typing again
  pinError.classList.add('hidden');
});

// ── Initialize ──
async function init() {
  console.log('[Votify] Host screen initializing...');

  // Generate QR code
  generateQRCode();

  // Load initial queue
  await refreshQueueDisplay();

  // Set up realtime
  setupRealtime();

  // Initialize YouTube player (waits for API to be ready)
  initPlayer();

  showToast('Host mode active — waiting for songs! 🎧', 'success');
}

// Start: check PIN first
if (checkPinAuth()) {
  // Already authenticated this session
  pinGate.classList.add('hidden');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
} else {
  // Show PIN gate, hide main layout
  hostLayout.style.display = 'none';
  pinInput.focus();
}
