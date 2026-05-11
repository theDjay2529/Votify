# Votify V2 Project Context

This file is the living source of truth for the **Votify V2** implementation. Update it whenever a major feature, schema change, or architectural shift is made.

---

## 1. What Votify Is

Votify is a real-time, crowd-controlled YouTube music experience. A Host starts a "Room", participants join via QR code, and everyone votes on the music queue together.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML5, CSS3, ES6+ JS |
| Build Tool | Vite |
| Backend/DB | Supabase (Postgres + Auth + Realtime) |
| Hosting | Vercel (Production) |
| Playback | YouTube IFrame Player API |
| Listen Together | Silent Disco (Clock-synced State Broadcasting via Realtime) |
| Realtime | Supabase Channels (Presence + Broadcast + Postgres Changes) |
| Search | Piped API (Primary) → Invidious (Fallback) |

---

## 3. File Structure

### Pages
- `index.html` — **Landing Page**: Entry point with "Join Room" and "Host Room" options (Dark themed).
- `home.html` — **Host Dashboard**: Manage active/paused rooms, create new rooms.
- `auth.html` — Login page (Google OAuth + Username/Password).
- `host.html` — Host Projector Screen (playback + controls).
- `join.html` — Participant entry (room code input).
- `participant.html` — Participant remote (search, vote, skip).

### JS Modules
- `js/supabase-config.js` — Supabase client init.
- `js/auth.js` — Auth guards, session helpers, profile management.
- `js/rooms.js` — Room lifecycle (create/pause/activate/delete/kick/ban).
- `js/voting.js` — Upvote, downvote, skip vote, local vote state.
- `js/host.js` — Playback authority, presence broadcaster, history tab.
- `js/participant.js` — Search, add songs, vote, queue rendering (mirrors host exactly).
- `js/home.js` — Dashboard logic: active + paused rooms, create room modal.

### API & Config
- `vercel.json` — Deployment config for routing, rewrites, and API handling.
- `netlify.toml` — (Legacy/Backup) Netlify deployment config.

### CSS
- `css/global.css` — Design tokens, glassmorphism, shared utilities.
- `css/home.css` — Dashboard styles, modal styles.
- `css/host.css` — Host layout, queue/history tabs, drawer styles.
- `css/participant.css` — Mobile queue cards, voting controls, now playing.

---

## 4. Database Schema (V2)

### Tables
| Table | Purpose |
|---|---|
| `profiles` | Maps `auth.users` → custom username |
| `rooms` | Room metadata: code, name, pin, status, host_id |
| `queue` | Songs: upvotes, downvotes, played flag, added_by |
| `votes_cast` | Per-user vote tracking (prevents double voting) |
| `room_participants` | Active participant log per room |
| `room_bans` | Kicked participant tokens + `display_name` per room |
| `skip_votes` | Democratic skip votes (threshold = 50% of participants) |

### Room Status Values
| Status | Meaning |
|---|---|
| `active` | Room is live, host is present, participants can add/vote |
| `paused` | Host left temporarily; participants can watch but not add/vote. Hosts may have multiple paused rooms. |
| `ended` | Deprecated (use `delete` instead) |

### Room Creation Rule
- A host can have **one active room** at a time.
- A host can have **multiple paused rooms**.
- Creating a new room is allowed while old rooms are paused.
- Rejoining a paused room activates it, so it will fail if the host already has another active room.

---

## 5. Realtime Architecture — Hybrid Model

All clients join a single channel: `room-{ROOM_CODE}`.

| Channel Type | Events | Purpose |
|---|---|---|
| Postgres Changes | `queue *` | Queue persistence updates |
| Postgres Changes | `rooms UPDATE` | Detect pause/active/ended status (Fallback) |
| Postgres Changes | `room_bans INSERT` | Backup kick enforcement |
| Presence | `sync` | Host tracks `currentSong` & `roomStatus` for new joiners |
| Broadcast | `now_playing` | **Instant** song sync when track changes |
| Broadcast | `sync_playback` | Periodically sent by the host in Listen Together mode to sync participants' timelines |
| Broadcast | `room_status_update` | **Instant** pause/resume sync |
| Broadcast | `kick` | **Instant** removal of banned participants |

> **Critical Rule**: Postgres Changes can have 200-2000ms latency. Broadcasts are sub-100ms. Always send a Broadcast ping *after* any DB write that needs instant UI feedback.

---

## 6. Key Flows

### 6.1 Landing & Auth
- `index.html` is the root. It checks for a session.
- If a logged-in host visits, "Host a Room" links to `home.html`.
- If unauthenticated, it goes to `auth.html`.
- Participants go directly to `join.html`.

### 6.2 Host Leave / Rejoin
1. Host clicks **Leave Session** → `pauseRoom(roomId)` → `host.js` broadcasts `room_status_update: paused` → redirect to `home.html`.
2. Participants' listener fires instantly → room paused banner appears → search/voting disabled.
3. Host rejoins from `home.html` → `host.js` loads → calls `activateRoom(roomId)` → participants see "Host is back!" toast.

### 6.3 Participants Drawer
- Darkened backdrop (75% opacity + 12px blur) with click-outside-to-close.
- **Banned Tab** shows `display_name` (if available) for better identification.

---

## 7. Known Bug Fixes Applied This Session

| Bug | Fix |
|---|---|
| "Failed to add song" false error | Moved `syncChannel` to module scope in `participant.js`. |
| Skip button logic | Corrected column name from `room_item_id` to `queue_item_id`. |
| Ghost login (dhananjaypatel) | Corrected post-login redirects to `home.html` instead of `index.html`. |
| Participant Sync Lag | Added `now_playing` and `room_status_update` broadcasts. Later tightened drift threshold to 0.4s and sync ping to 1000ms. *Note: a tiny bit of lag still remains to be fixed.* |
| Kicked users had no names | Added `display_name` column to `room_bans` table. |
| Modal UI regressions | Redesigned Create Room modal and added `hidden` class to stray confirm modals. |
| Paused rooms blocked new room creation | Restored active-only room creation guard; paused rooms remain saved/rejoinable. |
| Host Search Availability | Removed listen_together strict check, made search bar always visible pill-shape in host UI. |
| Participant Room Close Pop-up | Switched listener from UPDATE to DELETE event to instantly show room closure modal without refresh. |
| Listen Together UI Polish | Re-styled participant panel to be minimal, modern, and material-expressive with custom slider and glass UI. |

---

## 8. Environment Variables

Votify V2 uses Vercel for production hosting. All variables must be set in the Vercel Dashboard (Settings > Environment Variables).

```
VITE_SUPABASE_URL           — Supabase project URL
VITE_SUPABASE_ANON_KEY      — Supabase public API key
VITE_DEPLOYED_URL           — Base URL for QR code generation (e.g., https://votifyv2.vercel.app)
VITE_LIVEKIT_URL            — LiveKit Cloud WebSocket URL for Listen Together
VITE_SUPABASE_FUNCTIONS_URL — Set to "/api" for production Vercel deployment
LIVEKIT_API_KEY             — LiveKit server API key (Secret)
LIVEKIT_API_SECRET          — LiveKit server API secret (Secret)
```

Create `.env` locally for development. Use `npx vercel --prod` to deploy manual updates if GitHub sync is disabled.

---

## 9. SQL Patches Required in Supabase Dashboard

Run these when deploying schema changes. The `.sql` file is the source of truth but changes must be applied manually via Supabase SQL Editor. The realtime publication block is guarded because Supabase errors if a table is already a publication member.

```sql
-- 1. Add display_name to room_bans
ALTER TABLE room_bans ADD COLUMN IF NOT EXISTS display_name TEXT;

-- 2. Allow reading paused rooms publicly
DROP POLICY IF EXISTS "active rooms are publicly readable" ON rooms;
CREATE POLICY "active rooms are publicly readable"
  ON rooms FOR SELECT USING (status IN ('active', 'paused') OR auth.uid() = host_id);

-- 3. Allow host to DELETE their rooms
DROP POLICY IF EXISTS "host can delete their room" ON rooms;
CREATE POLICY "host can delete their room"
  ON rooms FOR DELETE USING (auth.uid() = host_id);

-- 4. Host can update queue even when paused
DROP POLICY IF EXISTS "host can update any queue row" ON queue;
CREATE POLICY "host can update any queue row"
  ON queue FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM rooms WHERE rooms.id = queue.room_id AND rooms.host_id = auth.uid()
  ));

-- 5. Realtime for required tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'queue'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.queue;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'skip_votes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.skip_votes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'room_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.room_participants;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'room_bans'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.room_bans;
  END IF;
END $$;

-- 6. Allow paused as a persisted room status
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_status_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_status_check
  CHECK (status IN ('active', 'paused', 'ended'));

-- 7. Prevent creating another room while one is active
DROP INDEX IF EXISTS one_active_room_per_host;
CREATE UNIQUE INDEX one_active_room_per_host
  ON rooms(host_id) WHERE status = 'active';
```

---

## 10. Maintenance Rules

1. **Schema changes** → Always update `supabase-schema-v2.sql` AND the SQL Patches section above.
2. **New realtime interactions** → Add a Broadcast fallback alongside Postgres Changes.
3. **Cache busting** → Increment `?v=X` in script tags in HTML files after JS logic changes.
4. **Never use `const` for shared channel variables** — must be module-level `let`.

---

## 11. Phase 1 Status

Phase 1 is considered code-complete for the web Queue Room foundation:

- Host auth and profile setup are implemented.
- `home.html` is the authenticated host dashboard.
- `host.html` is the room-scoped host playback screen.
- Room creation supports Queue Room mode, optional PINs, and one-active-room enforcement.
- Hosts can have multiple paused rooms and can create a new room while old rooms remain paused.
- Participant join supports room code, PIN, guest identity, and authenticated identity.
- Queue, voting, skip votes, moderation, kick/ban, pause, and rejoin are room-scoped.
- Realtime uses room-scoped Supabase channels with broadcasts for instant UI sync.
- `dashboard.html`, `host_6969.html`, and the V1 `supabase-schema.sql` have been removed from the active app.

External deployment follow-up: schedule `expire_inactive_rooms()` in Supabase if automatic stale-room cleanup is required in production.

---

## 12. Phase 2 Status

Phase 2 web Listen Together implementation is production-ready on Vercel:

- Listen Together room creation is enabled from `home.html`.
- Listen Together rooms set `livekit_room_name` to the Votify room code.
- `js/webrtc.js` wraps LiveKit browser connection, host tab-audio publishing, participant audio subscription, volume, and resync.
- `host.html` uses a streamlined audio control (Play/Pause) below the player to share browser tab audio.
- `participant.html` shows a Listen Together panel with start listening, local volume, and resync controls.
- `api/livekit-token.js` mints LiveKit JWTs on Vercel and only allows the room host to publish.
- **Production URL**: `https://votifyv2.vercel.app` (configured with `V2` branch deployment).

---

## 13. Phase 3 Status (Completed)

Phase 3 (Web UI Polish) is complete:

- Added skeleton loader states to the participant queue while data is fetching.
- Redesigned the "Empty Queue" state to match the premium glassmorphism aesthetic.
- **Strategic Decision**: We explicitly decided to skip the PWA "Add to Home Screen" configuration. To prevent fragmenting our user base and avoid confusing users with a "fake" app, we want to drive all "App" installations to the upcoming native Flutter app (which includes Android Auto features). The web app remains a frictionless, zero-install QR portal for quick participant voting.
- *Note: There is a minor 0.4s audio sync lag during Listen Together playback that was intentionally deprioritized and deferred to a later optimization sweep.*

---

## 14. Pending Roadmap: Flutter Native App

With the web foundation complete, all future development moves to the **Flutter Native App**.

### Phase 4 — Flutter: Core App (2-3 weeks)
- **What**: Build the true native app (not a WebView) using `supabase_flutter`.
- **Goals**: Implement Supabase Auth, the Host Dashboard, QR code generation/scanning, and full feature parity for "Queue Mode".
- **Deliverable**: A native Android app that connects to the same Supabase backend as the web app.

### Phase 5 — Flutter: Listen Together + Android Auto (2-3 weeks)
- **What**: Integrate `just_audio`, the LiveKit Flutter SDK (`livekit_client`), and `audio_service`.
- **Goals**: The Android app captures audio using `just_audio` (bypassing the YouTube IFrame restriction) and broadcasts it to participants via LiveKit. The queue and transport controls are projected onto the car dashboard via Android Auto.
- **Deliverable**: The ultimate party trick—hosts control the Listen Together room straight from their car's steering wheel while their phone runs in the background.

### Phase 6 — Premium Streaming Services (Future)
- **What**: Moving away from YouTube/Piped scraping.
- **Goals**: Integrate official Spotify SDKs or YouTube Music OAuth to provide ad-free, high-fidelity audio streams for premium hosts.
