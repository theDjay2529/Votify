import { supabase } from './supabase-config.js';

// ============================================================
//  VOTIFY V2 — Auth Module
//  Handles: Google OAuth, username+password login, guest tokens,
//           auth guards, and first-time profile setup.
// ============================================================

const AUTH_REDIRECT = new URL('auth.html', window.location.href).toString();

// ── Guest Token ──────────────────────────────────────────────
// Each anonymous participant gets a persistent UUID in localStorage.
// This is used as their identity for voting and presence — not a security boundary.
export function getOrCreateGuestToken() {
  let token = localStorage.getItem('votify_guest_token');
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem('votify_guest_token', token);
  }
  return token;
}

// ── Session Helpers ──────────────────────────────────────────
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

// ── Auth Guards ──────────────────────────────────────────────
// Call at the top of any host-only page.
// Returns the session if authenticated, otherwise redirects to auth.html.
export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.replace('auth.html');
    return null;
  }
  return session;
}

// ── Google OAuth Sign-In ─────────────────────────────────────
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: AUTH_REDIRECT,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });
  if (error) throw error;
}

// ── Username + Password Sign-In ──────────────────────────────
// Looks up the email linked to the username, then authenticates with Supabase.
export async function signInWithUsername(username, password) {
  if (!username || !password) throw new Error('Username and password are required.');

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('email')
    .eq('username', username.toLowerCase().trim())
    .maybeSingle();

  if (profileErr) throw new Error('Failed to look up account. Please try again.');
  if (!profile) throw new Error('No account found with that username.');

  const { error } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password,
  });

  if (error) {
    if (error.message.includes('Invalid login')) {
      throw new Error('Incorrect password. Please try again.');
    }
    throw error;
  }
}

// ── Sign Out ─────────────────────────────────────────────────
export async function signOut() {
  await supabase.auth.signOut();
  window.location.replace('index.html');
}

// ── Profile Helpers ──────────────────────────────────────────
export async function getProfile(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return data;
}

// A profile is "complete" once the host has set a real username
// (the auto-generated stub starts with 'user_')
export function isProfileComplete(profile) {
  return profile && !profile.username.startsWith('user_');
}

// ── First-Time Profile Setup ─────────────────────────────────
// Called after first Google OAuth sign-in to set username + optional password.
export async function setupProfile({ userId, email, username, password }) {
  const clean = username.toLowerCase().trim();

  if (clean.length < 6) throw new Error('Username must be at least 6 characters.');
  if (!/^[a-z0-9_]+$/.test(clean)) {
    throw new Error('Username may only contain lowercase letters, numbers, and underscores.');
  }

  // Uniqueness check (DB has a UNIQUE constraint but we catch it early for UX)
  const { data: taken } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', clean)
    .maybeSingle();

  if (taken && taken.id !== userId) throw new Error('That username is already taken.');

  // Try to update the existing stub row (created by the on_auth_user_created trigger).
  // If the trigger hasn't run yet, fall back to inserting the row directly.
  const { error: updateErr, count } = await supabase
    .from('profiles')
    .update({ username: clean, email })
    .eq('id', userId)
    .select('id', { count: 'exact', head: true });

  if (updateErr) throw updateErr;

  // count === 0 means the trigger row didn't exist yet — insert it directly.
  if (count === 0) {
    const { error: insertErr } = await supabase
      .from('profiles')
      .insert({ id: userId, username: clean, email });
    if (insertErr) throw insertErr;
  }

  if (password) {
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');
    const { error: pwErr } = await supabase.auth.updateUser({ password });
    if (pwErr) {
      // Supabase rejects if the new password is the same as the old one.
      // This is non-fatal — the account is still valid. Just skip it.
      if (!pwErr.message.toLowerCase().includes('different')) {
        throw pwErr;
      }
      // else: same password → silently ignore, profile save still succeeds.
    }
  }
}
