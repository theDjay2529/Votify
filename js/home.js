import { requireAuth, getProfile, signOut } from './auth.js';
import { createRoom, getActiveRoom, getPausedRooms, deleteRoom } from './rooms.js';

// ── Auth Guard ────────────────────────────────────────────────
const session = await requireAuth();
if (!session) throw new Error('Not authenticated');

const user = session.user;

// ── Toast ─────────────────────────────────────────────────────
const toastContainer = document.getElementById('toast-container');
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  toastContainer.appendChild(t);
  setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 300); }, 3500);
}

// ── Confirm Dialog ────────────────────────────────────────────
function confirmDialog(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    modal.classList.remove('hidden');
    modal.classList.add('visible');
    const onOk     = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const cleanup  = () => {
      modal.classList.remove('visible');
      modal.classList.add('hidden');
      document.getElementById('confirm-ok').removeEventListener('click', onOk);
      document.getElementById('confirm-cancel').removeEventListener('click', onCancel);
    };
    document.getElementById('confirm-ok').addEventListener('click', onOk);
    document.getElementById('confirm-cancel').addEventListener('click', onCancel);
  });
}

// ── Load Profile ──────────────────────────────────────────────
const profile = await getProfile(user.id);
const displayName = profile?.username || user.email?.split('@')[0] || 'Host';
document.getElementById('home-username').textContent = `@${displayName}`;
document.getElementById('home-greeting').textContent = `Welcome back, ${displayName} 👋`;

// ── Sign Out ──────────────────────────────────────────────────
document.getElementById('btn-signout').addEventListener('click', signOut);

// ── Active Room Check ─────────────────────────────────────────
let activeRoom = null;

async function loadActiveRoom() {
  activeRoom = await getActiveRoom(user.id);
  const banner = document.getElementById('active-room-banner');

  if (activeRoom) {
    document.getElementById('active-room-name').textContent = activeRoom.name;
    document.getElementById('active-room-code').textContent = `Code: ${activeRoom.code}`;
    banner.classList.remove('hidden');
    disableModePicker(true);
  } else {
    banner.classList.add('hidden');
    disableModePicker(false);
  }
}

document.getElementById('btn-rejoin-room').addEventListener('click', () => {
  if (activeRoom) window.location.href = `host_6969.html?room=${activeRoom.code}`;
});

document.getElementById('btn-end-room').addEventListener('click', async () => {
  const confirmed = await confirmDialog('Close Room', `Permanently delete "${activeRoom?.name}"? This cannot be undone.`);
  if (confirmed && activeRoom) {
    try {
      await deleteRoom(activeRoom.id);
      showToast('Room deleted.', 'success');
      activeRoom = null;
      await loadActiveRoom();
      await loadPausedRooms();
    } catch (err) {
      showToast('Failed to delete room: ' + err.message, 'error');
    }
  }
});

// ── Paused Rooms ──────────────────────────────────────────────
async function loadPausedRooms() {
  const rooms = await getPausedRooms(user.id);
  const section = document.getElementById('paused-rooms-section');
  const list = document.getElementById('paused-rooms-list');

  if (!section || !list) return;

  if (!rooms.length) {
    section.classList.add('hidden');
    disableModePicker(!!activeRoom);
    return;
  }

  disableModePicker(!!activeRoom);
  section.classList.remove('hidden');
  list.innerHTML = rooms.map(r => `
    <div class="recent-room-item glass-card" data-room-id="${r.id}" data-room-code="${r.code}" data-room-name="${escapeHtml(r.name)}">
      <div class="recent-room-info">
        <span class="recent-room-mode-badge" style="background:rgba(124,58,237,0.2);color:#a78bfa;border:1px solid rgba(124,58,237,0.3);">⏸️ Paused</span>
        <div class="recent-room-name">${escapeHtml(r.name)}</div>
        <div class="recent-room-meta">
          <code class="room-code-chip">${r.code}</code>
          <span class="recent-room-date">${formatDate(r.created_at)}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <a href="host_6969.html?room=${r.code}" class="btn-primary btn-sm">Rejoin</a>
        <button class="btn-secondary btn-sm btn-danger-outline btn-close-paused" data-room-id="${r.id}" data-room-name="${escapeHtml(r.name)}">Close</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.btn-close-paused').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await confirmDialog('Close Paused Room', `Delete "${btn.dataset.roomName}"? All data will be lost.`);
      if (confirmed) {
        try {
          await deleteRoom(btn.dataset.roomId);
          showToast('Room deleted.', 'success');
          await loadPausedRooms();
          await loadActiveRoom();
        } catch (err) {
          showToast('Failed to delete: ' + err.message, 'error');
        }
      }
    });
  });
}

// ── Room Creation Modal ───────────────────────────────────────
let selectedMode = null;

function openCreateModal(mode) {
  selectedMode = mode;
  const icons = { queue: '🖥️', listen_together: '🔊' };
  const titles = { queue: 'Start a Queue Room', listen_together: 'Start a Listen Together Room' };
  document.getElementById('modal-icon').textContent = icons[mode];
  document.getElementById('modal-title').textContent = titles[mode];
  document.getElementById('create-room-modal').classList.remove('hidden');
  document.getElementById('create-room-modal').classList.add('visible');
  document.getElementById('room-name').focus();
  document.getElementById('room-form-error').classList.add('hidden');
  document.getElementById('create-room-form').reset();
  document.getElementById('room-pin').classList.add('hidden');
}

document.getElementById('btn-queue-room').addEventListener('click', () => {
  if (activeRoom) {
    showToast('You already have an active room. Leave it first before creating a new one.', 'error');
    return;
  }
  openCreateModal('queue');
});

document.getElementById('btn-listen-room').addEventListener('click', () => {
  showToast('Listen Together is coming in Phase 2!', 'info');
});

document.getElementById('modal-close').addEventListener('click', () => {
  closeCreateModal();
});

document.getElementById('create-room-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeCreateModal();
});

document.getElementById('room-pin-toggle').addEventListener('change', (e) => {
  document.getElementById('room-pin').classList.toggle('hidden', !e.target.checked);
  if (e.target.checked) document.getElementById('room-pin').focus();
});

document.getElementById('create-room-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('room-name').value.trim();
  const pinEnabled = document.getElementById('room-pin-toggle').checked;
  const pin = pinEnabled ? document.getElementById('room-pin').value.trim() : null;
  const errEl = document.getElementById('room-form-error');
  const btn = document.getElementById('btn-create-submit');

  errEl.classList.add('hidden');

  if (!name) {
    errEl.textContent = 'Please enter a room name.';
    errEl.classList.remove('hidden');
    return;
  }
  if (pinEnabled && (!pin || pin.length < 4)) {
    errEl.textContent = 'PIN must be at least 4 digits.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    const room = await createRoom({ name, mode: selectedMode, pin });
    showToast(`Room "${room.name}" created! Code: ${room.code}`, 'success');
    closeCreateModal();
    setTimeout(() => {
      window.location.href = `host_6969.html?room=${room.code}`;
    }, 600);
  } catch (err) {
    errEl.textContent = err.message || 'Failed to create room. Please try again.';
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Create Room';
  }
});

// ── Utilities ─────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function closeCreateModal() {
  const modal = document.getElementById('create-room-modal');
  modal.classList.remove('visible');
  modal.classList.add('hidden');
}

function disableModePicker(disabled) {
  const modePicker = document.getElementById('mode-picker');
  modePicker.style.opacity = disabled ? '0.5' : '';
  modePicker.style.pointerEvents = disabled ? 'none' : '';
}

// ── Init ──────────────────────────────────────────────────────
await Promise.all([loadActiveRoom(), loadPausedRooms()]);
