# Votify Project Context

This file is the living source of truth for the current Votify implementation. Update it whenever a major feature, schema change, deployment change, or entry-point change is made.

## 1. What Votify Is

Votify is a real-time, crowd-controlled YouTube music queue for live events.

The app has two main user experiences:

- Host screen: projector / speaker output that plays the queue, shows the current song, and displays a QR code for joining.
- Participant screen: mobile-first page where attendees search for songs, add them to the queue, and vote songs up.

The system is built as a static frontend that talks directly to Supabase for persistence and realtime sync.

## 2. Current Tech Stack

- Frontend: Vanilla HTML, CSS, and JavaScript.
- Build tool: Vite.
- Backend: Supabase Postgres, Supabase Realtime, and one RPC function.
- Search: Piped instances first, then Invidious instances as fallback.
- Playback: YouTube IFrame Player API.
- QR code rendering: qrcode.js loaded from CDN.

## 3. File Structure

Root files:

- `index.html`: landing page with a single join button and feature cards.
- `host_6969.html`: host projector view with PIN gate, QR code, player, and queue sidebar.
- `participant.html`: attendee mobile view with search, now-playing card, and queue list.
- `supabase-schema.sql`: database schema and permissions for the queue table and vote RPC.
- `vite.config.js`: Vite config, dev server settings, and multiple HTML entry points.
- `netlify.toml`: deployment config and redirect behavior.
- `.env.example`: required environment variables template.
- `README.md`: quick start and event setup instructions.
- `PROJECT_CONTEXT.md`: this living implementation summary.

Source folders:

- `css/global.css`: shared design tokens and common utilities.
- `css/host.css`: host screen layout and queue/player styling.
- `css/participant.css`: participant screen layout and queue/search styling.
- `js/supabase-config.js`: Supabase client initialization.
- `js/host.js`: host playback, QR generation, realtime sync, PIN handling, queue rendering.
- `js/participant.js`: song search, vote/add logic, anti-spam local storage, realtime queue rendering.

## 4. Entry Points And Routing

The app is a multi-page Vite build.

- `/` loads `index.html`.
- `/host_6969.html` loads the host view.
- `/participant.html` loads the attendee view.

Important note: the host page is not a SPA route. It is a standalone HTML file with its own module entry point.

## 5. Runtime Architecture

### 5.1 Host Flow

The host page does four jobs:

1. Protect access with a PIN gate.
2. Generate a QR code pointing to the participant page.
3. Fetch the current queue from Supabase and play the top song with YouTube IFrame Player.
4. Subscribe to realtime queue changes and keep the queue sidebar updated.

The host logic is in `js/host.js` and is initialized only after the correct PIN is entered or already stored in `sessionStorage`.

### 5.2 Participant Flow

The participant page does five jobs:

1. Accept text search input.
2. Search YouTube-style endpoints through Piped or Invidious.
3. Show results as tappable cards.
4. Add a new queue item or vote an existing unplayed item.
5. Render the live queue and now-playing status from Supabase realtime updates.

The participant logic is in `js/participant.js` and starts automatically on page load.

## 6. Supabase Backend

The backend is intentionally small.

### 6.1 Queue Table

The current schema in `supabase-schema.sql` creates a single `queue` table with the following fields:

- `id` UUID primary key, defaulting to `uuid_generate_v4()`.
- `youtube_id` TEXT, required.
- `title` TEXT, required.
- `thumbnail_url` TEXT, optional.
- `votes` INTEGER, default `1`.
- `played` BOOLEAN, default `false`.
- `created_at` TIMESTAMPTZ, default UTC `now()`.

### 6.2 Realtime

Realtime is enabled on the `queue` table through the Supabase publication:

- `ALTER PUBLICATION supabase_realtime ADD TABLE queue;`

Both host and participant subscribe to postgres changes on this table and re-fetch/render the queue when inserts or updates happen.

### 6.3 Vote RPC

The database includes a small RPC function:

- `increment_vote(row_id UUID)`

It performs an atomic `UPDATE queue SET votes = votes + 1 WHERE id = row_id;` inside Postgres. This avoids lost updates when multiple people vote at nearly the same time.

### 6.4 RLS And Policies

Row Level Security is enabled, but permissive policies are added for hackathon-style public use:

- public select
- public insert
- public update
- public delete

This means the queue is writable by the connected clients without requiring auth.

## 7. Environment Variables

The app expects these Vite env vars:

- `VITE_SUPABASE_URL`: Supabase project URL.
- `VITE_SUPABASE_ANON_KEY`: Supabase anon key.
- `VITE_HOST_PIN`: 5-digit host PIN for the projector screen.
- `VITE_DEPLOYED_URL`: deployed public base URL used when generating the QR code.

The example file is `.env.example`. Copy it to `.env` and replace placeholder values.

## 8. Host Implementation Details

### 8.1 Authentication Gate

The host screen is locked behind a PIN overlay in `host_6969.html`.

- The entered PIN is compared against `import.meta.env.VITE_HOST_PIN`.
- A successful unlock sets `sessionStorage.votify_host_auth = 'true'`.
- If already authenticated in this session, the host page skips the gate.

### 8.2 QR Code Generation

`js/host.js` generates a QR code that points to the participant page.

- If `VITE_DEPLOYED_URL` exists, it is used as the base.
- Otherwise it falls back to `window.location.origin`, which makes local Wi-Fi testing work.
- The QR is rendered with `QRCode` from the CDN-loaded qrcode.js library.

### 8.3 Playback Loop

Playback is driven from the `queue` table, sorted by:

1. `votes` descending.
2. `created_at` ascending.

The host:

- queries the top unplayed song,
- loads `youtube_id` into the YouTube player,
- listens for `YT.PlayerState.ENDED`,
- marks the current song as played,
- then loads the next song after a short delay.

If the YouTube player emits an error, the host treats it as a skip and advances the queue.

### 8.4 Realtime Presence

The host uses a Supabase channel named `votify-sync` and tracks presence data containing:

- `isHost: true`
- `currentSong`

Participants read this presence data so they can show the exact track the host is playing, instead of guessing from the queue order.

### 8.5 Host Queue Rendering

The host queue sidebar renders all unplayed songs except the current song as an “Up Next” list.

- It updates the stats counters for queue length and played count.
- It uses FLIP animation to preserve motion when queue order changes.
- It supports deleting a track by marking it `played: true` after confirmation.
- It supports clear-queue by marking all unplayed rows as played.
- It supports skip-track by marking the current song as played.

### 8.6 Host Visual Layer

The host page also includes a canvas-based background visualizer.

- It draws animated vertical bars with a purple-to-cyan gradient.
- The amplitude is higher while a song is active.
- This is purely presentational and does not affect playback.

## 9. Participant Implementation Details

### 9.1 Search Providers

Search is implemented as a fallback chain.

1. Try Piped instances.
2. If all Piped attempts fail, try Invidious instances.

The code uses a small list of public instances and returns the first successful result set.

Each result is normalized into:

- `youtube_id`
- `title`
- `thumbnail_url`
- `author`

### 9.2 Search UX

Search input is debounced by 400 ms.

- The clear button appears only when text is present.
- Skeleton cards are shown while the search request is in flight.
- Results render as tappable cards with thumbnails and title/author text.
- An error toast appears if all search endpoints fail.

### 9.3 Add Song Logic

When a user taps a result card:

1. The app checks whether an unplayed row already exists for that `youtube_id`.
2. If one exists, it increments votes through the `increment_vote` RPC.
3. If one does not exist, it inserts a new queue row with `votes: 1`.

This means the same song becomes a single queue item instead of duplicate rows.

### 9.4 Anti-Spam / Duplicate Vote Memory

Participant-side anti-spam is implemented with `localStorage`.

- The app stores voted queue row IDs in `votify_voted_ids`.
- If the user already voted a row, the UI blocks another upvote.
- If the user has not voted a row yet, the code can upvote it and then remember the ID.

Important limitation: this is a client-side guard, not a security boundary. The database is still public by design.

### 9.5 Queue Rendering

The participant queue renders all unplayed songs sorted the same way as the host.

- It shows the current playing song title in the mini now-playing area.
- It keeps the queue badge updated with the current number of unplayed songs.
- It uses FLIP animation for reordering.
- It highlights vote state on each queue card button.

### 9.6 Presence Sync

Participants subscribe to the same `votify-sync` channel as the host.

- They listen for postgres changes on `queue`.
- They inspect channel presence state for a presence entry with `isHost`.
- If host presence is available, they use `currentSong` to populate the now-playing title.
- If host presence is unavailable, they fall back to the first unplayed queue item.

## 10. Shared UI And Styling System

The styling strategy is shared and fairly consistent across the app.

### 10.1 Global Tokens

`css/global.css` defines the design system:

- dark background palette,
- purple and cyan accents,
- glassmorphism surfaces,
- spacing scale,
- radius scale,
- shadows,
- timing/easing tokens,
- utility classes such as `glass-card`, `btn-primary`, `btn-secondary`, and `gradient-text`.

### 10.2 Host Styling

`css/host.css` defines:

- three-column desktop layout,
- QR section,
- stats cards,
- now-playing panel,
- player container,
- idle state,
- queue sidebar,
- toast and modal integration,
- responsive behavior for the host screen.

### 10.3 Participant Styling

`css/participant.css` defines:

- sticky mobile header,
- sticky search bar,
- search results cards,
- skeleton loaders,
- mini now-playing strip,
- vote-able queue cards,
- large touch targets.

## 11. Landing Page

`index.html` is a lightweight marketing/entry page.

- It introduces the app.
- It points users directly to the participant screen.
- It uses the shared global design tokens and a few inline landing-specific styles.

## 12. Build And Dev Setup

### 12.1 Development

- `npm install`
- `npm run dev`

Vite runs the app on port 3000 and opens the browser automatically.

### 12.2 Production Build

- `npm run build`

The build outputs a static site suitable for hosting on Netlify or similar platforms.

### 12.3 Vite Inputs

`vite.config.js` explicitly declares the three HTML entry files so Vite builds them all:

- `index.html`
- `host_6969.html`
- `participant.html`

## 13. Deployment Notes

The repo includes `netlify.toml` with a build command and publish directory.

Current redirect behavior:

- visitor requests are redirected to `/participant.html`.

This makes the participant screen the default public experience on deployed builds.

## 14. Important Behavior Notes

- The host screen is protected by a PIN, but the PIN is a convenience gate, not strong security.
- The queue is intentionally public because the use case is a live event.
- Song search is done through third-party public endpoints, so availability can vary.
- Realtime is essential for the experience; if Supabase is disconnected, both screens show reconnect behavior.
- The app currently assumes a flat queue model with one playing song and one ordered list of unplayed songs.

## 15. Maintenance Rules For Future Changes

When making a major change, update this file in the same change set if the change affects any of the following:

- HTML entry points or routes.
- Supabase schema, functions, policies, or realtime channels.
- Search providers or playback behavior.
- Authentication or host access behavior.
- Environment variables.
- Deployment or build configuration.
- File structure or ownership of major features.

When documenting a new feature, include:

- what user flow it changes,
- what file owns the logic,
- what backend data it touches,
- how it syncs in realtime,
- and any failure mode or fallback behavior.

## 16. Current High-Level Data Flow

```text
Participant search input
  -> Piped / Invidious search
  -> result card tap
  -> Supabase queue insert or increment_vote RPC
  -> realtime postgres change
  -> host queue refresh + participant queue refresh
  -> host playback advances when current song ends
```

## 17. Quick Reference Snippets

### 17.1 Environment Variables

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_HOST_PIN
VITE_DEPLOYED_URL
```

### 17.2 Core Database Shape

```text
queue:
  id UUID primary key
  youtube_id text
  title text
  thumbnail_url text
  votes integer
  played boolean
  created_at timestamptz
```

### 17.3 Core Client Modules

```text
js/supabase-config.js
js/host.js
js/participant.js
```

## 18. Practical Notes For Another AI

If another AI is picking up this repo, the most important facts are:

- The queue lives in Supabase, not in local state.
- The host is the playback authority.
- Participants can only search, add, and vote.
- Both screens depend on the same realtime table.
- The app is intentionally simple: one table, one RPC, two UI modes.
