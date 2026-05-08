import { supabase } from './supabase-config.js';
import { getRoom, verifyRoomPin, roomRequiresPin } from './rooms.js';
import { getOrCreateGuestToken } from './auth.js';

// ── Toast ─────────────────────────────────────────────────────
const toastContainer = document.getElementById('toast-container');
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  toastContainer.appendChild(t);
  setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 300); }, 3500);
}

// ── Step Manager ──────────────────────────────────────────────
const steps = { code: 'step-code', pin: 'step-pin', identity: 'step-identity' };
function showStep(name) {
  Object.values(steps).forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById(steps[name]).classList.remove('hidden');
}

// ── State ─────────────────────────────────────────────────────
let resolvedRoom = null; // Room object after code validation
showStep('code');

// Uppercase as user types
document.getElementById('code-input').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// ── Step 1: Room Code ─────────────────────────────────────────
document.getElementById('code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('code-input').value.trim().toUpperCase();
  const errEl = document.getElementById('code-error');
  const btn = document.getElementById('btn-join-code');

  errEl.classList.add('hidden');

  if (code.length < 6) {
    errEl.textContent = 'Room codes are 6 characters long.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Looking up room...';

  try {
    const room = await getRoom(code);
    if (!room) {
      errEl.textContent = 'Room not found or has ended. Double-check the code.';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Join Room →';
      return;
    }
    resolvedRoom = room;

    // Check if room requires PIN
    const needsPin = await roomRequiresPin(code);
    if (needsPin) {
      document.getElementById('pin-room-name').textContent = room.name;
      showStep('pin');
    } else {
      document.getElementById('identity-room-name').textContent = room.name;
      showStep('identity');
    }
  } catch (err) {
    errEl.textContent = 'Failed to look up room. Please try again.';
    errEl.classList.remove('hidden');
  }

  btn.disabled = false;
  btn.textContent = 'Join Room →';
});

// ── Step 2: PIN Verification ──────────────────────────────────
document.getElementById('btn-back-from-pin').addEventListener('click', () => showStep('code'));

document.getElementById('pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = document.getElementById('pin-input').value;
  const errEl = document.getElementById('pin-error');
  const btn = document.getElementById('btn-submit-pin');

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    const valid = await verifyRoomPin(resolvedRoom.code, pin);
    if (!valid) {
      errEl.textContent = 'Incorrect PIN. Ask the host for the correct PIN.';
      errEl.classList.remove('hidden');
      document.getElementById('pin-input').value = '';
      document.getElementById('pin-input').focus();
    } else {
      // PIN correct — proceed to identity step
      document.getElementById('identity-room-name').textContent = resolvedRoom.name;
      showStep('identity');
    }
  } catch {
    errEl.textContent = 'Verification failed. Please try again.';
    errEl.classList.remove('hidden');
  }

  btn.disabled = false;
  btn.textContent = 'Verify PIN →';
});

// ── Step 3: Identity ──────────────────────────────────────────
function redirectToParticipant(token, displayName, isGuest) {
  const params = new URLSearchParams({
    room: resolvedRoom.code,
    token,
    name: displayName || '',
    guest: isGuest ? '1' : '0',
  });
  window.location.href = `participant.html?${params.toString()}`;
}

// Google sign-in for participants
document.getElementById('btn-participant-google').addEventListener('click', async () => {
  const btn = document.getElementById('btn-participant-google');
  btn.disabled = true;
  btn.textContent = 'Redirecting...';

  // Store the room code so we can redirect back after OAuth
  sessionStorage.setItem('votify_join_room', resolvedRoom.code);

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: new URL('participant.html', window.location.href).toString(),
    },
  });

  if (error) {
    showToast('Google sign-in failed.', 'error');
    btn.disabled = false;
    btn.textContent = 'Sign in with Google';
  }
});

// Guest join
document.getElementById('btn-guest').addEventListener('click', () => {
  const name = document.getElementById('guest-name').value.trim() || 'Guest';
  const token = getOrCreateGuestToken();
  redirectToParticipant(token, name, true);
});

// ── Handle direct QR-code links (?room=CODE already in URL) ──
const urlParams = new URLSearchParams(window.location.search);
const directCode = urlParams.get('room');
if (directCode) {
  // Pre-fill and auto-submit
  document.getElementById('code-input').value = directCode.toUpperCase();
  document.getElementById('code-form').dispatchEvent(new Event('submit'));
}
