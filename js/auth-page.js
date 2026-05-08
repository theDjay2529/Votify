import { supabase } from './supabase-config.js';
import {
  signInWithGoogle,
  signInWithUsername,
  getSession,
  getProfile,
  isProfileComplete,
  setupProfile,
} from './auth.js';

// ── Toast ────────────────────────────────────────────────────
const toastContainer = document.getElementById('toast-container');
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  toastContainer.appendChild(t);
  setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 300); }, 3500);
}

// ── Redirect if already authenticated ────────────────────────
async function checkExistingSession() {
  const session = await getSession();
  if (!session) return;

  const profile = await getProfile(session.user.id);
  if (!profile || !isProfileComplete(profile)) {
    // New user — show setup overlay
    showSetupOverlay(session.user);
  } else {
    // Already fully set up — go to home screen
    window.location.replace('home.html');
  }
}

// ── Google Sign-In ───────────────────────────────────────────
document.getElementById('btn-google').addEventListener('click', async () => {
  const btn = document.getElementById('btn-google');
  btn.disabled = true;
  btn.textContent = 'Redirecting...';
  try {
    await signInWithGoogle();
  } catch (err) {
    showToast(err.message || 'Google sign-in failed.', 'error');
    btn.disabled = false;
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6C12.3 13.1 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 6.9-10 6.9-17z"/><path fill="#FBBC05" d="M10.4 28.7A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.2-7.7 2.2-6.3 0-11.6-4.2-13.6-9.9l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg> Continue with Google`;
  }
});

// ── Username/Password Form ────────────────────────────────────
const form = document.getElementById('auth-form');
const formError = document.getElementById('form-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('input-username').value.trim();
  const password = document.getElementById('input-password').value;
  const submitBtn = document.getElementById('btn-submit');

  formError.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in...';

  try {
    await signInWithUsername(username, password);
    window.location.replace('home.html');
  } catch (err) {
    formError.textContent = err.message;
    formError.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
});

// ── Password Visibility Toggle ────────────────────────────────
document.getElementById('btn-toggle-pw').addEventListener('click', () => {
  const input = document.getElementById('input-password');
  const show = document.getElementById('pw-icon-show');
  const hide = document.getElementById('pw-icon-hide');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  show.classList.toggle('hidden', isHidden);
  hide.classList.toggle('hidden', !isHidden);
});

// ── Profile Setup Overlay ─────────────────────────────────────
let pendingUser = null;

function showSetupOverlay(user) {
  pendingUser = user;
  document.getElementById('setup-overlay').classList.remove('hidden');
}

document.getElementById('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('setup-username').value;
  const password = document.getElementById('setup-password').value;
  const errEl = document.getElementById('setup-error');
  const btn = document.getElementById('btn-setup-submit');

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    await setupProfile({
      userId: pendingUser.id,
      email: pendingUser.email,
      username,
      password: password || null,
    });
    showToast('Profile set up! Welcome to Votify 🎧', 'success');
    setTimeout(() => window.location.replace('home.html'), 1000);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Save & Continue →';
  }
});

// ── Handle OAuth Callback ─────────────────────────────────────
// Supabase fires an auth state change when returning from Google redirect
supabase.auth.onAuthStateChange(async (event, session) => {
  try {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
      const profile = await getProfile(session.user.id);
      if (!profile || !isProfileComplete(profile)) {
        showSetupOverlay(session.user);
      } else {
        window.location.replace('home.html');
      }
    }
  } catch (err) {
    console.error('Auth state change error:', err);
    showToast('Authentication error. Try again.', 'error');
    document.getElementById('btn-submit').textContent = 'Sign In';
    document.getElementById('btn-submit').disabled = false;
  }
});

// ── Init ──────────────────────────────────────────────────────
checkExistingSession();
