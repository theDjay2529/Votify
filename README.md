# Votify V2

Votify is a real-time, crowd-controlled YouTube music queue. A host creates a room, participants join by room code or QR link, and everyone votes the queue together.

Phase 1 is the web foundation: auth, rooms, Queue Room mode, participant join, voting, skip votes, pause/rejoin, and host moderation. Phase 2 adds web Listen Together mode with LiveKit-powered tab-audio streaming.

## Tech Stack

- Frontend: Vanilla HTML, CSS, and ES modules
- Build tool: Vite
- Backend: Supabase Auth, Postgres, RLS, and Realtime
- Playback: YouTube IFrame Player API
- Listen Together: LiveKit Cloud and Supabase Edge Functions
- Search: Piped API with Invidious fallback

## Main Entry Points

- `index.html`: public landing page
- `auth.html`: host auth and profile setup
- `home.html`: host dashboard and room creation
- `host.html`: host projector/playback screen
- `join.html`: participant room-code entry
- `participant.html`: participant remote

## Setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase-schema-v2.sql`.
3. Create a local `.env` file in the project root. This file is intentionally ignored by Git.
4. Add your local environment values:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_DEPLOYED_URL=http://localhost:3000
VITE_LIVEKIT_URL=wss://YOUR_LIVEKIT_PROJECT.livekit.cloud
VITE_SUPABASE_FUNCTIONS_URL=http://127.0.0.1:54321/functions/v1
```

5. Install and run:

```bash
npm install
npm run dev
```

The dev server runs at `http://localhost:3000`.

## Build

```bash
npm run build
```

The static build outputs to `dist/`.

## Listen Together Local Setup

1. Create a LiveKit Cloud project.
2. Copy the LiveKit WebSocket URL into `VITE_LIVEKIT_URL`.
3. Copy the LiveKit API key and secret.
4. Create `supabase/.env.local` for local Edge Function secrets:

```env
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
LIVEKIT_API_KEY=YOUR_LIVEKIT_API_KEY
LIVEKIT_API_SECRET=YOUR_LIVEKIT_API_SECRET
```

5. Serve the token function locally. The Docker-free Node server is easiest for local testing:

```bash
npm run dev:tokens
```

The Supabase CLI version is also available if Docker Desktop is healthy:

```bash
npx supabase functions serve livekit-token --env-file supabase/.env.local --no-verify-jwt
```

The LiveKit API secret must stay server-side. The browser only receives short-lived room tokens from `supabase/functions/livekit-token`. Netlify/deployed function setup can wait until production.

## Project Notes

- `PROJECT_CONTEXT.md` is the living implementation status document.
- `Votify_V2_Architecture.md` is the product architecture and roadmap reference.
- `supabase-schema-v2.sql` is the current database source of truth.
- A host can have one active room and multiple paused rooms.
- `.env` is local-only and should not be committed.
