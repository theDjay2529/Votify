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
// Deployed URL is loaded from VITE_DEPLOYED_URL in .env
// If empty, falls back to current window location (works for localhost on same Wi-Fi).
const DEPLOYED_URL = import.meta.env.VITE_DEPLOYED_URL || '';

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
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) throw error;

    if (data && data.length > 0) {
      const song = data[0];
      currentSong = song;
      broadcastState();

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
      broadcastState();
      
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
      .order('votes', { ascending: false })
      .order('created_at', { ascending: true });

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

    // Render queue with FLIP animation
    if (upNext.length === 0) {
      queueEmpty.classList.remove('hidden');
      Array.from(queueList.children).forEach(c => {
        if (c.id !== 'queue-empty') c.remove();
      });
    } else {
      queueEmpty.classList.add('hidden');

      // 1. Record current positions (First)
      const oldRects = new Map();
      Array.from(queueList.children).forEach(child => {
        if (child.dataset.id) {
          oldRects.set(child.dataset.id, child.getBoundingClientRect());
        }
      });

      // 2. Remove deleted elements
      const newIds = new Set(upNext.map(s => s.id));
      Array.from(queueList.children).forEach(child => {
        if (child.dataset.id && !newIds.has(child.dataset.id)) {
          child.remove();
        }
      });

      // 3. Update existing or Add new (Last)
      upNext.forEach((song, index) => {
        const rankClass = index < 3 ? `top-${index + 1}` : '';
        let card = queueList.querySelector(`.queue-song[data-id="${song.id}"]`);
        
        if (!card) {
          card = document.createElement('div');
          card.className = 'queue-song';
          card.dataset.id = song.id;
          
          card.innerHTML = `
            <span class="queue-song-rank ${rankClass}">${index + 1}</span>
            <img class="queue-song-thumb" src="${song.thumbnail_url || ''}" alt="" onerror="this.style.display='none'" />
            <div class="queue-song-info">
              <div class="queue-song-title" title="${song.title}">${song.title}</div>
            </div>
            <div class="queue-song-votes">
              <span class="arrow">▲</span> <span class="vote-count">${song.votes}</span>
            </div>
            <button class="btn-delete-track" data-id="${song.id}" title="Remove track">✕</button>
          `;
          
          // Attach delete listener
          const delBtn = card.querySelector('.btn-delete-track');
          delBtn.addEventListener('click', async (e) => {
            const isConfirmed = await showConfirmDialog(
              'Remove Track',
              'Remove this track from the queue?'
            );
            if (isConfirmed) {
              try {
                await supabase.from('queue').update({ played: true }).eq('id', song.id);
                refreshQueueDisplay();
              } catch (err) {
                console.error('[Votify] Error deleting track:', err);
              }
            }
          });
          
          queueList.appendChild(card);
        } else {
          // Update contents
          card.querySelector('.queue-song-rank').className = `queue-song-rank ${rankClass}`;
          card.querySelector('.queue-song-rank').textContent = index + 1;
          card.querySelector('.vote-count').textContent = song.votes;
          
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
  } catch (err) {
    console.error('[Votify] Error refreshing queue:', err);
  }
}

// ── Supabase Realtime ──
let syncChannel;

function broadcastState() {
  if (syncChannel) {
    syncChannel.track({ isHost: true, currentSong }).catch(err => console.error('[Votify] Error tracking presence:', err));
  }
}

function setupRealtime() {
  syncChannel = supabase.channel('votify-sync');

  syncChannel
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
    .subscribe(async (status) => {
      console.log('[Votify] Realtime status:', status);
      if (status === 'SUBSCRIBED') {
        reconnectBanner.classList.remove('visible');
        broadcastState();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reconnectBanner.classList.add('visible');
        showToast('Connection lost — attempting to reconnect...', 'error');
        setTimeout(() => {
          syncChannel.subscribe();
        }, 3000);
      }
    });
}

// ── PIN Gate ──
// PIN is loaded from VITE_HOST_PIN in .env — never hardcoded in source.
const HOST_PIN = import.meta.env.VITE_HOST_PIN || '00000';

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

// ── Custom Confirm Dialog ──
function showConfirmDialog(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const btnCancel = document.getElementById('modal-cancel');
    const btnConfirm = document.getElementById('modal-confirm');

    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.classList.add('visible');

    const cleanup = () => {
      modal.classList.remove('visible');
      btnCancel.removeEventListener('click', onCancel);
      btnConfirm.removeEventListener('click', onConfirm);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    const onConfirm = () => {
      cleanup();
      resolve(true);
    };

    btnCancel.addEventListener('click', onCancel);
    btnConfirm.addEventListener('click', onConfirm);
  });
}

// ── Clear Queue ──
document.getElementById('btn-clear-queue')?.addEventListener('click', async () => {
  const isConfirmed = await showConfirmDialog(
    'Clear Queue',
    'Are you sure you want to completely clear the upcoming queue?'
  );
  if (isConfirmed) {
    try {
      await supabase.from('queue').update({ played: true }).eq('played', false);
      showToast('Queue cleared', 'success');
      refreshQueueDisplay();
    } catch (err) {
      console.error('[Votify] Error clearing queue:', err);
      showToast('Failed to clear queue', 'error');
    }
  }
});

// ── Skip Track ──
document.getElementById('btn-skip-track')?.addEventListener('click', () => {
  if (currentSong) {
    showToast('Skipping track...', 'info');
    markCurrentAsPlayed();
  }
});

// ── Visualizer Background ──
function initVisualizer() {
  const canvas = document.getElementById('visualizer-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  let time = 0;
  function draw() {
    requestAnimationFrame(draw);
    time += 0.01; // Slower animation
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const bars = 50;
    const barWidth = canvas.width / bars;
    const midY = canvas.height / 2;
    
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(168, 85, 247, 0.8)');
    gradient.addColorStop(1, 'rgba(6, 182, 212, 0.8)');
    
    ctx.fillStyle = gradient;
    
    for (let i = 0; i < bars; i++) {
      let noise = Math.sin(time + i * 0.2) * Math.cos(time * 0.6 + i * 0.1) * Math.sin(time * 0.3 - i * 0.05);
      let amplitude = currentSong ? 300 : 50;
      let height = Math.abs(noise) * amplitude + 20;
      
      ctx.fillRect(i * barWidth, midY - height, barWidth - 8, height * 2);
    }
  }
  draw();
}

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
  
  // Start visualizer background
  initVisualizer();

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
