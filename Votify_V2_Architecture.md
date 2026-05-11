# Votify V2 — Full Product Architecture Plan

> This document is the complete planning reference for scaling Votify from a single-event hackathon tool into a multi-room, cross-platform product. It supersedes all previous planning notes. Treat it as the source of truth before writing any code.

---

## Table of Contents

1. [The Big Picture](#1-the-big-picture)
2. [Authentication & Accounts](#2-authentication--accounts)
3. [Rooms](#3-rooms)
4. [The Two Room Modes](#4-the-two-room-modes)
5. [Listen Together — WebRTC Architecture](#5-listen-together--webrtc-architecture)
6. [Voting System — Upvote, Downvote & Skip](#6-voting-system--upvote-downvote--skip)
7. [Participant Management & Moderation](#7-participant-management--moderation)
8. [Premium Features](#8-premium-features)
9. [Web App Upgrade Plan](#9-web-app-upgrade-plan)
10. [Flutter Native App Plan](#10-flutter-native-app-plan)
11. [Android Auto](#11-android-auto)
12. [Ad-Free Playback — The Honest Plan](#12-ad-free-playback--the-honest-plan)
13. [Full Database Schema](#13-full-database-schema)
14. [Build Phases & Sequencing](#14-build-phases--sequencing)
15. [Resolved Decisions](#15-resolved-decisions)

---

## 1. The Big Picture

### What Votify V1 Was

A single-session tool. One hardcoded host PIN, one global queue table, one event at a time. Brilliant for a hackathon, not scalable beyond it.

### What Votify V2 Is

A multi-room, dual-mode platform:

- Any authenticated host creates a **Room** — their own isolated session
- Each room runs in one of two modes chosen at creation time (cannot switch mid-session)
- **Host Machine Mode** — classic Votify: one projector plays the queue, crowd votes from phones
- **Listen Together Mode** — host's device streams audio via WebRTC to all participants simultaneously
- A Flutter native Android app runs alongside the web app, sharing the same Supabase backend
- Android Auto integration lets a host control playback from the car dashboard

### The Core Rules (Constraints That Shape Everything)

- **One active room per host account.** A host must end their current room before creating a new one. This eliminates the complexity of managing Host Mode + Listen Together conflicts on the same device.
- **Mode is chosen at room creation.** No mid-session switching. Host sees two buttons on the home screen: "Start Queue Room" and "Start Listen Together Room."
- **Participants are anonymous by default** but are offered a sign-in prompt. Guest flow requires zero friction.
- **The web app is upgraded first.** Flutter is built in parallel after the web foundation is solid.

---

## 2. Authentication & Accounts

### 2.1 Host Authentication Flow

Hosts must have an account. Here is the exact flow:

**First-time sign-in:**
1. Host clicks "Sign in with Google" (OAuth via Supabase Auth)
2. OAuth completes — Supabase creates an `auth.users` entry
3. App detects this is a new account (no matching `profiles` row)
4. App prompts: **"Choose a Username"** and **"Set a Password"**
   - Username is their Votify display identity (shown in rooms, history)
   - Password allows them to log in on other devices without Google
5. Profile is saved. Host lands on their home screen.

**Returning sign-in (same device):**
- Google OAuth auto-completes (session already exists in Supabase)
- Host lands directly on home screen — no friction

**Returning sign-in (different/temp device):**
- Host can use Google OAuth again (triggers auto-login to their account)
- OR host can use **Username + Password** directly — no Google required

**Implementation note:** Supabase Auth handles both OAuth and email/password natively. The "password" set after OAuth is implemented by calling `supabase.auth.updateUser({ password })` immediately after first OAuth login. This links a password credential to the OAuth account, enabling both login paths going forward.

### 2.2 Participant Authentication Flow

Participants scan the QR code and land on the join page. They immediately see a modal:

```
┌─────────────────────────────────────┐
│  Join the Room                      │
│                                     │
│  [Sign in with Google]              │
│  [Sign in with Username + Password] │
│                                     │
│  ───────── or ─────────             │
│                                     │
│  [Continue as Guest →]              │
└─────────────────────────────────────┘
```

- **Signed-in participants:** their display name comes from their profile. Their vote history is tied to their account (slightly stronger anti-spam).
- **Guest participants:** they get a random UUID stored in `localStorage` as their guest token. They can optionally set a display name. Vote history is tracked by this token.

No participant is ever forced to create an account.

### 2.3 Profile Table

```sql
CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT UNIQUE NOT NULL CHECK (length(username) >= 6),  -- min 6 chars
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### 2.4 Removing The Hardcoded PIN

The current `VITE_HOST_PIN` environment variable and PIN gate on `host_6969.html` are **completely removed** in V2. Access control is replaced by:

- Host pages require an active Supabase Auth session
- The session is checked on page load — unauthenticated users are redirected to login
- Room ownership is verified against `rooms.host_id = auth.uid()`
- The obscure `host_6969.html` filename is replaced with a proper `host.html`

---

## 3. Rooms

### 3.1 Room Creation Flow

Host lands on their home screen (post-login). They see:

```
┌─────────────────────────────────────────────────┐
│  Welcome back, [Username] 👋                    │
│                                                 │
│  ┌─────────────────┐  ┌─────────────────┐      │
│  │  🎧 Queue Room  │  │  🔊 Listen      │      │
│  │                 │  │     Together    │      │
│  │  One screen     │  │                 │      │
│  │  plays. Crowd   │  │  Everyone's     │      │
│  │  votes.         │  │  phone plays    │      │
│  │                 │  │  in sync.       │      │
│  │  [Start Room]   │  │  [Start Room]   │      │
│  └─────────────────┘  └─────────────────┘      │
│                                                 │
│  Your recent rooms: [history list]             │
└─────────────────────────────────────────────────┘
```

Tapping either button:
1. Checks if host already has an active room → if yes, shows: *"You already have an active room. End it first or rejoin it."*
2. If no active room → prompts for a **Room Name** (e.g. "Arjun's Party")
3. Optional: set a **Room PIN** (4-digit, protects against randos joining if the code leaks)
4. Creates the room in Supabase, generates a 6-character room code (e.g. `NEON42`)
5. Redirects host to their host screen

### 3.2 Room Codes

- 6-character alphanumeric, uppercase, ambiguous characters removed (no O/0, I/1, etc.)
- Unique among currently **active** rooms (codes can be reused after rooms end)
- Embedded in QR code and shareable link: `votify.app/room/NEON42`

### 3.3 Joining A Room

Participants can join via:
- Scanning the QR code (direct link)
- Manually entering the room code at `votify.app/join`
- Tapping a shared link

If the room has a PIN, they are prompted for it after entering the code.

### 3.4 Room Lifecycle

```
Host creates room → ACTIVE
        ↓
Participants join via QR / code
        ↓
Room runs (queue mode or listen together mode)
        ↓
Host taps "End Room" → ENDED
        ↓
Queue becomes read-only, no new participants
        ↓
Auto-cleanup: rooms ended for 7+ days are archived
```

Auto-expiry: if a room has no activity for 24 hours, it is automatically set to ENDED by a Supabase scheduled job (pg_cron or an Edge Function on a cron trigger).

### 3.5 One Room Per Host — Enforcement

Enforced at two levels:

**Database level:**
```sql
CREATE UNIQUE INDEX one_active_room_per_host
ON rooms(host_id)
WHERE status = 'active';
```
This makes it physically impossible at the DB layer for a host to have two active rooms simultaneously.

**Application level:**
Before the create-room flow, the app queries:
```javascript
const { data } = await supabase
  .from('rooms')
  .select('id, code, mode')
  .eq('host_id', user.id)
  .eq('status', 'active')
  .single();

if (data) {
  // Show "rejoin or end" prompt instead of create form
}
```

### 3.6 Participant Resync Button

In Listen Together mode, every participant's screen shows a **"Resync"** button. Tapping it:
1. Unsubscribes from the LiveKit audio track
2. Re-subscribes immediately (rejoins at the live stream position)
3. Shows a brief "Resyncing..." indicator

This is a self-heal button for the one device that drifted — it does not affect other participants.

---

## 4. The Two Room Modes

Mode is set at room creation and **cannot be changed mid-session.**

### 4.1 Queue Room Mode

The classic Votify experience:
- One host screen (projector/browser) plays videos via YouTube IFrame
- Participants search, add songs, and vote
- Queue auto-advances when a song ends
- Host can skip, delete, and clear the queue
- Realtime vote updates push to all participants and the host screen

Nothing about this mode changes from V1 except it is now room-scoped.

### 4.2 Listen Together Mode

- Host's device captures and streams audio via WebRTC (via LiveKit SFU) to all participants
- Participants hear the audio through their own device's speaker
- Queue and voting still work identically — the queue determines what plays next
- Host controls playback (play/pause/skip) from their screen
- Each participant has a local **Resync** button

The YouTube video plays on the host device — the audio output is captured and forwarded via WebRTC.

See Section 5 for the full WebRTC architecture.

---

## 5. Listen Together — WebRTC Architecture

### 5.1 Why WebRTC

WebRTC is the correct choice because:
- The host's browser captures the audio output directly — no YouTube extraction or re-hosting needed
- Audio flows peer-to-peer via an SFU relay — nothing is stored on any server
- No YouTube ToS violation — content is not downloaded or redistributed, just forwarded live
- Latency is 50-200ms in normal conditions — imperceptible as desync to human ears
- No per-stream server storage cost

### 5.2 Signaling Via Supabase Realtime

WebRTC requires a signaling channel to exchange connection metadata (SDP offers/answers and ICE candidates) before audio flows. Use Supabase Realtime as the signaling channel — no separate server needed.

Process:
1. Host broadcasts an SDP offer via Supabase channel `room-{code}-webrtc`
2. Each participant receives the offer and sends back an SDP answer
3. ICE candidates are exchanged the same way
4. Once connected, audio flows device-to-device via the SFU — Supabase is no longer involved

### 5.3 Connection Topology — LiveKit SFU

Direct 1-to-N WebRTC from the host is not practical beyond ~10 connections (host CPU and upload bandwidth become the bottleneck). Use a **Selective Forwarding Unit (SFU)**.

The host sends one upstream to the SFU. The SFU fans it out to all participants without decoding or re-encoding audio.

**Recommended SFU: [LiveKit](https://livekit.io)**
- Generous free tier on LiveKit Cloud
- Open-source, self-hostable if needed later
- First-class Flutter SDK (`livekit_client`) and JavaScript SDK
- Handles ICE, TURN, and connection recovery automatically

```
Host device
    │  (one WebRTC upstream)
    ▼
LiveKit SFU
    ├──→ Participant phone 1
    ├──→ Participant phone 2
    ├──→ Participant phone 3
    └──→ ... up to 200
```

### 5.4 Audio Capture — Web Host

Use `getDisplayMedia` with audio-only — captures the browser tab's audio output including the YouTube IFrame:

```javascript
const stream = await navigator.mediaDevices.getDisplayMedia({
  audio: true,
  video: false
});
// Publish this stream to the LiveKit room
await livekitRoom.localParticipant.publishTrack(stream.getAudioTracks()[0]);
```

The host is prompted once to share their tab's audio. After that, it is automatic.

### 5.5 Audio Capture — Flutter Host

Android does not allow regular apps to capture system audio output (`CAPTURE_AUDIO_OUTPUT` requires system-level privileges). The Flutter host therefore does not use the YouTube IFrame player in Listen Together mode.

Instead:
1. The Piped/Invidious API is used to resolve a `youtube_id` to a direct audio stream URL
2. `just_audio` plays that audio URL locally on the host device
3. The `livekit_client` package captures the `just_audio` output stream and publishes it to LiveKit

The user experience is identical — the host sees the song title, thumbnail, and controls. The difference is internal: audio comes from `just_audio` instead of a YouTube IFrame.

This is the one place the Flutter and web implementations differ internally. The participant experience is identical on both platforms.

### 5.6 LiveKit Access Tokens

LiveKit tokens are generated server-side to keep the LiveKit API secret off the client. Use a Supabase Edge Function:

```
POST /functions/v1/livekit-token
Body: { roomCode, participantId, isHost }
Returns: { token: "livekit-jwt..." }
```

Each Votify room in Listen Together mode maps to a LiveKit room with the same room code as its name.

### 5.7 Participant Audio Playback

Participants subscribe to the LiveKit room and the SDK handles audio output automatically — no custom audio code needed on the participant side. Works identically in the JS SDK (web) and `livekit_client` (Flutter).

### 5.8 Resync Button Implementation

LiveKit is a live stream — if a participant's connection drops and reconnects, they rejoin at the live position automatically. The Resync button handles audio glitching without a full disconnect:

```javascript
async function resync() {
  showStatus('Resyncing...');
  // Disconnect and reconnect to the LiveKit room
  await livekitRoom.disconnect();
  await livekitRoom.connect(LIVEKIT_URL, participantToken);
  showStatus('Synced');
}
```

### 5.9 Host Controls & Participant UI

**Host screen (Listen Together):**
- Now Playing card (title, thumbnail, progress)
- Play / Pause — controls the audio source
- Skip — marks current song played in Supabase, loads next
- Queue sidebar — same vote-ordered list as Queue Mode
- Participant count — number of active LiveKit subscribers
- Connection quality indicator

**Participant screen (Listen Together):**
- Animated "Listening" indicator with waveform
- Mini now-playing strip (song title, synced from Supabase presence)
- Local volume slider (controls their own speaker only)
- **[Resync]** button
- Full queue list with voting (same as Queue Mode)
- Search bar to add songs

---

---

## 6. Voting System - Upvote, Downvote and Skip

### 6.1 Upvote and Downvote

Voting works like Reddit. Each queue item has upvote and downvote counts. The queue is ordered by net score (upvotes minus downvotes) descending, then by created_at ascending as a tiebreaker.

**Rules:**
- A participant can upvote OR downvote a song, not both simultaneously
- Switching your vote (upvote to downvote) is allowed and handled atomically
- Anti-spam: one vote per participant per queue item, enforced server-side via the votes_cast table
- Client-side localStorage tracks vote state for instant UI feedback without a round-trip

**Queue ordering:**
```sql
ORDER BY (upvotes - downvotes) DESC, created_at ASC
```

**Participant queue card UI:**
```
[triangleup 24]  Song Title            [triangledown 3]
                 Artist Name
                 net score: +21
```

### 6.2 Voting RPC Functions

Two atomic database functions replace the old increment_vote function:

```sql
-- votes_cast: server-side vote memory (one row per participant per queue item)
CREATE TABLE votes_cast (
  id                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  queue_id          UUID NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  participant_token TEXT NOT NULL,
  vote_type         TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (queue_id, participant_token)
);

ALTER TABLE votes_cast ENABLE ROW LEVEL SECURITY;
CREATE POLICY "votes readable" ON votes_cast FOR SELECT USING (true);
CREATE POLICY "anyone can insert vote" ON votes_cast FOR INSERT WITH CHECK (true);
CREATE POLICY "anyone can update vote" ON votes_cast FOR UPDATE USING (true);

-- Atomic upvote (handles switching from downvote)
CREATE OR REPLACE FUNCTION cast_upvote(p_queue_id UUID, p_token TEXT)
RETURNS VOID AS $$
DECLARE existing TEXT;
BEGIN
  SELECT vote_type INTO existing FROM votes_cast
  WHERE queue_id = p_queue_id AND participant_token = p_token;

  IF existing IS NULL THEN
    INSERT INTO votes_cast (queue_id, participant_token, vote_type) VALUES (p_queue_id, p_token, 'up');
    UPDATE queue SET upvotes = upvotes + 1 WHERE id = p_queue_id;
  ELSIF existing = 'down' THEN
    UPDATE votes_cast SET vote_type = 'up' WHERE queue_id = p_queue_id AND participant_token = p_token;
    UPDATE queue SET upvotes = upvotes + 1, downvotes = downvotes - 1 WHERE id = p_queue_id;
  END IF;
  -- existing = 'up': already upvoted, idempotent no-op
END;
$$ LANGUAGE plpgsql;

-- Atomic downvote (handles switching from upvote)
CREATE OR REPLACE FUNCTION cast_downvote(p_queue_id UUID, p_token TEXT)
RETURNS VOID AS $$
DECLARE existing TEXT;
BEGIN
  SELECT vote_type INTO existing FROM votes_cast
  WHERE queue_id = p_queue_id AND participant_token = p_token;

  IF existing IS NULL THEN
    INSERT INTO votes_cast (queue_id, participant_token, vote_type) VALUES (p_queue_id, p_token, 'down');
    UPDATE queue SET downvotes = downvotes + 1 WHERE id = p_queue_id;
  ELSIF existing = 'up' THEN
    UPDATE votes_cast SET vote_type = 'down' WHERE queue_id = p_queue_id AND participant_token = p_token;
    UPDATE queue SET downvotes = downvotes + 1, upvotes = upvotes - 1 WHERE id = p_queue_id;
  END IF;
END;
$$ LANGUAGE plpgsql;
```

### 6.3 Skip Vote System

Any participant can vote to skip the currently playing song. If more than 50% of active participants vote to skip, the song skips immediately.

**Active participant count:** use Supabase Realtime presence count on the room channel. This reflects who is actually online, not a stale DB count.

**Skip vote flow:**
```
Participant taps [Skip vote] button
        down
INSERT into skip_votes (room_id, queue_item_id, participant_token)
        down
Supabase Realtime fires to all clients
        down
All clients recount: skip_votes.count vs active_participants
        down
If count / active_participants > 0.5:
  mark current song as played
  clear skip_votes for this queue item
  load next top-voted song
  toast on all screens: "Room voted to skip!"
```

**Skip votes table:**
```sql
CREATE TABLE skip_votes (
  id                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  room_id           UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  queue_item_id     UUID NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  participant_token TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (room_id, queue_item_id, participant_token)
);
```

**UI on participant screen:**
- Skip button shows live tally: [skip 4/9]
- Fills up as votes come in via Realtime
- Crossing threshold triggers an instant skip with toast

**Host override:** Host always has a unilateral skip button. No vote required.

---

## 7. Participant Management and Moderation

### 7.1 Participant List on Host Screen

The host screen has a Participants panel (tab or slide-out drawer) showing everyone currently in the room.

Each row shows:
- Display name (or "Guest #xxxx" for anonymous)
- Signed-in vs Guest badge
- Songs added count
- Votes cast count
- Time since joining
- [Kick] button

### 7.2 Kick Flow

When the host kicks a participant:
1. Their token (guest) or user_id (signed-in) is inserted into room_bans
2. A Supabase Realtime event fires on their personal channel (participant-{token})
3. Their client receives the kick event and redirects to a "You have been removed" page
4. All future requests from that token are blocked by RLS checking room_bans
5. Kick is room-scoped only - does not affect other rooms

```sql
CREATE TABLE room_bans (
  id                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  room_id           UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_token TEXT,
  user_id           UUID,
  banned_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (room_id, participant_token),
  UNIQUE (room_id, user_id)
);
```

### 7.3 Participant Tracking

```sql
CREATE TABLE room_participants (
  id                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  room_id           UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_token TEXT NOT NULL,
  display_name      TEXT,
  is_guest          BOOLEAN DEFAULT true,
  songs_added       INTEGER DEFAULT 0,
  votes_cast_count  INTEGER DEFAULT 0,
  joined_at         TIMESTAMPTZ DEFAULT now(),
  last_seen_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (room_id, participant_token)
);
```

Clients send a heartbeat ping every 30 seconds to update last_seen_at. Participants not seen for 2 minutes are shown as offline in the host panel (they are not removed - they may reconnect).

---

## 8. Premium Features

### 8.1 What Is Premium

Premium is a host-only upgrade. Participants are never charged. V2 uses a manual boolean flag - no payment integration yet (Stripe comes later).

```sql
-- Already added to profiles table above:
-- is_premium    BOOLEAN DEFAULT false
-- premium_since TIMESTAMPTZ
```

### 8.2 Saved Rooms (Premium Only, up to 3)

Free hosts: rooms expire after 24 hours of inactivity, data kept 7 days then archived.

Premium hosts: can save up to 3 rooms as persistent templates.

**What a saved room keeps:**
- Room name, mode, PIN settings
- The room code (reserved, never recycled)
- Full played song history (for replay feature)
- Participant history

**What restarting a saved room does:**
- Creates a fresh active session under the same code
- Queue starts empty (history kept separately)
- Future: push notification to past participants

**Enforcement at application level:**
```javascript
const { count } = await supabase
  .from('rooms')
  .select('id', { count: 'exact' })
  .eq('host_id', user.id)
  .eq('is_saved', true);

if (count >= 3) {
  showError('Unsave an existing room to save a new one.');
  return;
}
```

The auto-expire job skips saved rooms (is_saved = false condition in the WHERE clause).

### 8.3 Future Premium Ideas (Not In Scope For V2)

- Custom room themes and branding
- Analytics dashboard (songs played, peak participants, top voters)
- History beyond 7 days
- Larger participant limits
- Priority Spotify integration

---


## 9. Web App Upgrade Plan

The existing Vite + Vanilla JS codebase is upgraded in place. No framework migration.

### 6.1 Remove

- `VITE_HOST_PIN` env var and all references
- PIN gate overlay and PIN check logic
- `host_6969.html` filename → replaced with `host.html`
- Global single-room assumption in `js/host.js` and `js/participant.js`

### 6.2 New Files

```
auth.html                   — host login / signup page
join.html                   — participant room code entry page
js/auth.js                  — Supabase Auth helpers (login, logout, session, profile setup)
js/rooms.js                 — room creation, joining, code validation, lifecycle
js/webrtc.js                — LiveKit JS SDK wrapper for Listen Together
css/auth.css                — login and modal styles
```

### 6.3 Updated Files

```
index.html                  — host home screen (post-login)
                              mode picker (Queue Room / Listen Together Room)
                              recent rooms list

host.html                   — requires auth session check on load
                              room-scoped via URL param (?room=NEON42)
                              mode-aware (Queue UI or Listen Together UI)

participant.html             — auth/guest modal on load
                              room-scoped via URL param
                              mode-aware (voting queue or listen UI + resync button)

js/host.js                  — remove PIN logic
                              add room_id scoping throughout
                              add Listen Together branch (LiveKit publish)

js/participant.js            — add guest token generation
                              add auth/guest modal
                              add room_id scoping
                              add Listen Together branch (LiveKit subscribe + resync)

js/supabase-config.js        — no structural change

vite.config.js               — add auth.html, join.html as entry points
                              remove host_6969.html

netlify.toml                 — update redirects for new routes

.env.example                 — remove VITE_HOST_PIN
                              add VITE_LIVEKIT_URL
```

### 6.4 Environment Variables (V2)

```
VITE_SUPABASE_URL           (unchanged)
VITE_SUPABASE_ANON_KEY      (unchanged)
VITE_DEPLOYED_URL           (unchanged)
VITE_LIVEKIT_URL            (new) — LiveKit server WebSocket URL
```

Removed:
```
VITE_HOST_PIN               (deleted)
```

### 6.5 PWA

After core V2 features are stable, add:
- `manifest.json` (name, icons, theme `#0a0a0f`, accent `#7c3aed`)
- Service worker for offline shell caching
- Mobile viewport and standalone meta tags
- Android "Add to Home Screen" prompt

This gives Android users a near-native install experience while the Flutter app is being built.

---

## 10. Flutter Native App Plan

### 7.1 Approach

True native Flutter app — not a WebView wrapper. Shares the same Supabase backend and LiveKit infrastructure as the web app. All business logic re-implemented in Dart.

### 7.2 Project Structure

```
votify_flutter/
├── lib/
│   ├── main.dart
│   ├── app.dart                        — GoRouter, ThemeData
│   ├── services/
│   │   ├── supabase_service.dart       — all Supabase operations
│   │   ├── livekit_service.dart        — LiveKit audio publish/subscribe
│   │   ├── search_service.dart         — Piped/Invidious search with fallback
│   │   └── audio_handler.dart          — audio_service handler for Android Auto
│   ├── models/
│   │   ├── room.dart
│   │   ├── queue_item.dart
│   │   └── profile.dart
│   ├── screens/
│   │   ├── auth/
│   │   │   ├── login_screen.dart
│   │   │   └── profile_setup_screen.dart
│   │   ├── home/
│   │   │   └── home_screen.dart        — mode picker, room history
│   │   ├── host/
│   │   │   ├── queue_host_screen.dart
│   │   │   └── listen_host_screen.dart
│   │   ├── participant/
│   │   │   ├── join_screen.dart        — code entry + auth/guest modal
│   │   │   ├── queue_participant_screen.dart
│   │   │   └── listen_participant_screen.dart
│   │   └── android_auto/
│   │       └── auto_screen.dart
│   └── widgets/                        — shared UI components
├── android/
│   └── app/src/main/
│       ├── AndroidManifest.xml
│       └── res/xml/
│           └── automotive_app_desc.xml
└── pubspec.yaml
```

### 7.3 Flutter Dependencies

```yaml
dependencies:
  supabase_flutter: ^2.0.0          # Supabase client + auth
  livekit_client: ^2.0.0            # WebRTC for Listen Together
  just_audio: ^0.9.0                # Audio playback (Listen Together host)
  audio_service: ^0.18.0            # Background audio + Android Auto media session
  youtube_player_flutter: ^9.0.0    # YouTube IFrame (Queue Mode)
  go_router: ^12.0.0                # Navigation
  qr_flutter: ^4.0.0                # QR code generation
  mobile_scanner: ^4.0.0            # QR code scanning for joining
  shared_preferences: ^2.0.0        # Guest token + voted IDs
  dio: ^5.0.0                       # HTTP for search
  flutter_animate: ^4.0.0           # Animations
  google_sign_in: ^6.0.0            # Google OAuth
```

### 7.4 Listen Together on Flutter Host

As noted in Section 5.5, Flutter uses `just_audio` (not YouTube IFrame) as the audio source for Listen Together, because Android system audio capture is not available to regular apps. The flow:

1. Search returns `youtube_id`
2. Piped/Invidious API resolves it to a direct audio URL
3. `just_audio` plays the audio locally on host device
4. `livekit_client` captures and publishes the stream to LiveKit
5. Participants receive and play via their LiveKit subscription

### 7.5 Build & Release

- Debug: `flutter run`
- Release APK: `flutter build apk --release`
- Play Store bundle: `flutter build appbundle --release`
- Min SDK: 21 | Target SDK: 34

---

## 11. Android Auto

### 8.1 What Android Auto Can Show

Android Auto restricts UI to pre-approved templates. For a media app:
- **MediaBrowser** — the current queue as a browsable list
- **Transport controls** — play, pause, skip next, skip previous
- **Now Playing** — title, artist, thumbnail, progress bar

This maps perfectly to Votify. The host's phone connects to the car, the car screen shows the queue and controls.

### 8.2 Flutter Implementation via audio_service

```dart
class VotifyAudioHandler extends BaseAudioHandler {

  @override
  Future<void> play() async {
    audioPlayer.play();
    playbackState.add(playbackState.value.copyWith(
      playing: true,
      controls: [MediaControl.pause, MediaControl.skipToNext],
    ));
  }

  @override
  Future<void> pause() async {
    audioPlayer.pause();
    playbackState.add(playbackState.value.copyWith(playing: false));
  }

  @override
  Future<void> skipToNext() async {
    await supabaseService.markPlayed(currentSong.id);
    final next = await supabaseService.getNextSong(roomId);
    mediaItem.add(MediaItem(
      id: next.youtubeId,
      title: next.title,
      artUri: Uri.parse(next.thumbnailUrl),
    ));
    audioPlayer.setUrl(next.audioUrl);
    audioPlayer.play();
  }

  @override
  Future<List<MediaItem>> getChildren(String parentMediaId, [Map<String, dynamic>? options]) async {
    final queue = await supabaseService.getQueue(roomId);
    return queue.map((item) => MediaItem(
      id: item.youtubeId,
      title: item.title,
      artist: '${item.votes} votes',
      artUri: Uri.parse(item.thumbnailUrl),
    )).toList();
  }
}
```

### 8.3 AndroidManifest.xml

```xml
<application>
  <meta-data
      android:name="com.google.android.gms.car.application"
      android:resource="@xml/automotive_app_desc"/>
  <service
      android:name=".VotifyAudioService"
      android:exported="true">
    <intent-filter>
      <action android:name="android.media.browse.MediaBrowserService"/>
    </intent-filter>
  </service>
</application>
```

```xml
<!-- res/xml/automotive_app_desc.xml -->
<automotiveApp>
  <uses name="media"/>
</automotiveApp>
```

### 8.4 Google Play Review Timeline

Android Auto apps require Google review before the car screen integration is live. Timeline: 2-4 weeks. The app itself ships to the Play Store independently — only the Android Auto feature is gated on review. Submit early.

### 8.5 Flagship Demo Scenario

Host is driving. Phone is connected to Android Auto. Car speakers play audio via Bluetooth. Listen Together is active — LiveKit streams the car's audio to all participants' phones. Everyone hears the same music, through distributed speakers. Host controls playback from the steering wheel or car screen. This is the feature to lead demos with.

---

## 12. Ad-Free Playback — The Honest Plan

### 9.1 Why Not A Custom Ad Blocker

- **Maintenance:** YouTube changes ad delivery constantly — ongoing engineering cost
- **Play Store:** Google prohibits apps interfering with YouTube ads — rejection risk
- **Legal:** YouTube ToS prohibits ad circumvention — liability at scale

### 9.2 The Actual Path

**Now:** YouTube IFrame embeds in Queue Mode do not show ads in most embedded short-session contexts. Good enough for events.

**Listen Together on Flutter:** Uses `just_audio` with a direct audio URL — no IFrame, no ads by nature.

**Medium term:** Spotify SDK integration via `spotify_sdk`. Premium users get no ads. Replaces Piped/Invidious for Spotify tracks.

**Long term:** YouTube Music OAuth for Premium accounts. Authenticated Premium users get ad-free IFrame playback via the official API.

Route around the problem via legitimate integrations, not by fighting YouTube's ad system.

---

## 13. Full Database Schema

```sql
-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT UNIQUE NOT NULL CHECK (length(username) >= 6),  -- min 6 chars
  avatar_url    TEXT,
  is_premium    BOOLEAN DEFAULT false,
  premium_since TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Auto-create a profile stub on first sign-up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, 'user_' || substring(NEW.id::text, 1, 8));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- ROOMS
-- ============================================================
CREATE TABLE rooms (
  id                  UUID    DEFAULT uuid_generate_v4() PRIMARY KEY,
  code                TEXT    UNIQUE NOT NULL,
  name                TEXT    NOT NULL,
  host_id             UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pin                 TEXT,                           -- optional 4-digit room PIN
  status              TEXT    DEFAULT 'active',       -- 'active' | 'ended'
  mode                TEXT    NOT NULL,               -- 'queue' | 'listen_together'
  livekit_room_name   TEXT,                           -- set for listen_together rooms
  is_saved            BOOLEAN DEFAULT false,
  saved_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  last_active_at      TIMESTAMPTZ DEFAULT now()
);

-- One active room per host, enforced at DB level
CREATE UNIQUE INDEX one_active_room_per_host
ON rooms(host_id)
WHERE status = 'active';

CREATE INDEX idx_rooms_code   ON rooms(code);
CREATE INDEX idx_rooms_host   ON rooms(host_id);
CREATE INDEX idx_rooms_status ON rooms(status);

-- ============================================================
-- QUEUE
-- ============================================================
CREATE TABLE queue (
  id            UUID    DEFAULT uuid_generate_v4() PRIMARY KEY,
  room_id       UUID    NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  youtube_id    TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  thumbnail_url TEXT,
  upvotes       INTEGER DEFAULT 1,
  downvotes     INTEGER DEFAULT 0,
  played        BOOLEAN DEFAULT false,
  added_by      TEXT,   -- display name or guest token
  created_at    TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE INDEX idx_queue_room        ON queue(room_id);
CREATE INDEX idx_queue_room_played ON queue(room_id, played);

-- Keep room activity timestamp fresh
CREATE OR REPLACE FUNCTION touch_room_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE rooms SET last_active_at = now() WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER queue_touches_room
AFTER INSERT OR UPDATE ON queue
FOR EACH ROW EXECUTE FUNCTION touch_room_activity();

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE queue;
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE skip_votes;
ALTER PUBLICATION supabase_realtime ADD TABLE room_participants;

-- ============================================================
-- RPC FUNCTIONS
-- ============================================================

-- DEPRECATED: replaced by cast_upvote / cast_downvote (see Section 6.2)
CREATE OR REPLACE FUNCTION increment_vote(row_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE queue SET votes = votes + 1 WHERE id = row_id;
END;
$$ LANGUAGE plpgsql;

-- Generate a unique 6-character room code (no ambiguous characters)
CREATE OR REPLACE FUNCTION generate_room_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code  TEXT := '';
  i     INTEGER;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM rooms WHERE rooms.code = code AND status = 'active'
    );
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- Auto-expire rooms inactive for 24 hours
-- Schedule this via Supabase Edge Function cron or pg_cron
CREATE OR REPLACE FUNCTION expire_inactive_rooms()
RETURNS VOID AS $$
BEGIN
  UPDATE rooms
  SET status = 'ended'
  WHERE status = 'active'
    AND is_saved = false
    AND last_active_at < now() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE rooms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue    ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "profiles are publicly readable"
ON profiles FOR SELECT USING (true);

CREATE POLICY "users can update own profile"
ON profiles FOR UPDATE USING (auth.uid() = id);

-- Rooms
CREATE POLICY "active rooms are publicly readable"
ON rooms FOR SELECT USING (status = 'active');

CREATE POLICY "authenticated users can create rooms"
ON rooms FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = host_id);

CREATE POLICY "host can manage their room"
ON rooms FOR UPDATE USING (auth.uid() = host_id);

-- Queue
CREATE POLICY "queue is readable for active rooms"
ON queue FOR SELECT
USING (EXISTS (
  SELECT 1 FROM rooms WHERE rooms.id = queue.room_id AND rooms.status = 'active'
));

CREATE POLICY "anyone can add to active room queue"
ON queue FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM rooms WHERE rooms.id = queue.room_id AND rooms.status = 'active'
));

CREATE POLICY "anyone can update queue rows in active rooms"
ON queue FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM rooms WHERE rooms.id = queue.room_id AND rooms.status = 'active'
));
```

---

## 14. Build Phases & Sequencing

### Phase 1 — Web: Auth + Rooms (5-7 days)

Foundation for everything. Do not proceed until this is end-to-end tested.

- Remove hardcoded PIN, rename `host_6969.html` → `host.html`
- Supabase Auth: Google OAuth + username/password post-OAuth setup
- Profile creation on first login
- Home screen: mode picker (Queue / Listen Together)
- Room creation, code generation, one-active-room enforcement
- Room schema + RLS deployed
- Queue scoped to `room_id` throughout
- Realtime channels scoped to room code
- Participant join: code entry + auth/guest modal
- QR code encodes room URL
- Room lifecycle: end room, rejoin existing room, auto-expire

**Deliverable:** Multiple simultaneous rooms. Full V1 feature parity plus upvote/downvote, skip voting, and host moderation.

---

### Phase 2 — Web: Listen Together (COMPLETED ✅)

Finalized the "Silent Disco" architecture using Supabase Realtime for high-precision signaling and state synchronization.

- **Realtime Sync Engine**: Implemented a timestamp-validated `updatedAt` system to prevent state reverts from ghost presences.
- **Listen Together UI**:
    - **Paused State**: Integrated a dulled, blurred glass-pane overlay (`.pause-overlay`) for both host and participants.
    - **Host Controls**: Added a persistent, pill-shaped search bar directly on the host projector screen for "on-the-fly" song additions.
    - **Participant Safety & UI**: Re-styled the listen-panel to a premium, material-expressive design, fixed room closure routing (DELETE event listener), and added a step-by-step backtracking modal.
- **Synchronized Playback**: Tightened sync drift threshold to 0.4s and implemented an adaptive sync interval (1000ms) to stabilize the audio feed.

**Deliverable:** Listen Together is production-ready. Host syncs playback state via Broadcast events, and participants follow in near-realtime with visual feedback.

---

### Phase 3 — Web: PWA + Polish (Next Steps)

- **Service Workers**: Implement `manifest.json` and service workers for "Add to Home Screen" support with standalone meta tags and Android install prompts.
- **Visual Polish**: Audit error states, empty states, and skeleton loaders for all new screens.
- **Performance**: Investigate and eliminate any residual audio jitter in high-latency network conditions.

**Deliverable:** Web app fully installable on Android home screen with a flawless offline shell.

---

### Phase 4 — Flutter: Core App (2-3 weeks)

- Project setup, GoRouter, ThemeData
- Supabase Auth in Flutter
- Home screen
- Queue Mode host + participant screens
- Realtime sync
- QR generation and camera scanning

**Deliverable:** Flutter app with full Queue Mode parity to web.

---

### Phase 5 — Flutter: Listen Together + Android Auto (2-3 weeks)

- `just_audio` + LiveKit for Flutter host audio
- Listen Together host and participant screens in Flutter
- `audio_service` AudioHandler
- Android Auto manifest declarations + media browser
- Background playback
- Submit for Google Android Auto review

**Deliverable:** Flutter supports Listen Together. Android Auto shows queue and transport controls.

---

### Phase 6 — Streaming Services (future)

- Spotify SDK integration
- YouTube Music OAuth for Premium accounts
- Source selector per room

---

## 15. Resolved Decisions

All decisions locked. Do not re-open without strong justification.

| # | Decision | Resolution |
|---|---|---|
| 1 | Production domain | `votify-vibeathon.netlify.app` for now. OAuth redirects, LiveKit origin, and QR base URL all use this. |
| 2 | Room discovery | Private by default. Join by code only. Public discovery added in a later phase. |
| 3 | Queue history | Kept 7 days after room ends, then archived. Saved rooms exempt from expiry entirely. |
| 4 | Vote rate limiting | Server-side via `votes_cast` table. One vote per participant per queue item enforced at DB level. |
| 5 | LiveKit hosting | LiveKit Cloud free tier for V2. Self-host when costs justify it. |
| 6 | Usernames | Unique globally, minimum 6 characters. DB CHECK constraint + client validation. |
| 7 | Saved rooms | Premium only. Max 3 per host. Code reserved, history retained. Manual flag in V2, Stripe later. |
| 8 | Vote types | Upvote + Downvote (Reddit-style). Net score `(upvotes - downvotes)` determines queue order. |
| 9 | Skip votes | Participants can vote to skip. Threshold: >50% of active participants. Host skip always instant. |
| 10 | Participant moderation | Host sees full participant list and can kick. Kick is room-scoped only. |
| 11 | Premium payment | Manual boolean flag in V2. Stripe payment integration in a future phase. |
