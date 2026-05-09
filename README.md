# Votify V2

Votify is a real-time, crowd-controlled YouTube music queue. A host creates a room, participants join by room code or QR link, and everyone votes the queue together.

Phase 1 is the web foundation: auth, rooms, Queue Room mode, participant join, voting, skip votes, pause/rejoin, and host moderation. Phase 2 adds web Listen Together mode with LiveKit-powered tab-audio streaming.

## Tech Stack

- **Frontend**: Vanilla HTML, CSS, and ES modules
- **Build tool**: Vite
- **Backend**: Supabase Auth, Postgres, RLS, and Realtime
- **Hosting**: Vercel (Production)
- **Playback**: YouTube IFrame Player API
- **Listen Together**: LiveKit Cloud
- **Serverless**: Vercel Functions (Node.js)
- **Search**: Piped API with Invidious fallback

## Main Entry Points

- `index.html`: public landing page
- `auth.html`: host auth and profile setup
- `home.html`: host dashboard and room creation
- `host.html`: host projector/playback screen
- `join.html`: participant room-code entry
- `participant.html`: participant remote

## Setup

1. Create a Supabase project and a LiveKit Cloud project.
2. In Supabase SQL Editor, run `supabase-schema-v2.sql`.
3. Create a local `.env` file in the project root.
4. Add your environment values:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_DEPLOYED_URL=https://your-site.vercel.app
VITE_LIVEKIT_URL=wss://YOUR_LIVEKIT_PROJECT.livekit.cloud
VITE_SUPABASE_FUNCTIONS_URL=/api
LIVEKIT_API_KEY=YOUR_LIVEKIT_API_KEY
LIVEKIT_API_SECRET=YOUR_LIVEKIT_API_SECRET
```

5. Install and run:

```bash
npm install
npm run dev
```

The dev server runs at `http://localhost:3000`.

## Production Deployment (Vercel)

Votify V2 is designed to run on Vercel for maximum performance and easy serverless scaling.

1. **GitHub Sync**: Connect your repository to Vercel.
2. **Environment Variables**: Add all the variables from the `.env` section above to the Vercel Dashboard (Settings > Environment Variables).
3. **Branch**: Ensure your `Production Branch` is set to `V2` (Settings > Git).
4. **Supabase Auth**: Add your Vercel URL (e.g., `https://votifyv2.vercel.app`) to your Supabase Project Settings > Auth > URL Configuration > Site URL and Redirect URIs.

## Listen Together

Phase 2 uses LiveKit for tab-audio streaming. The token generation logic is handled by `api/livekit-token.js` as a Vercel Serverless Function.

- **Host**: Click the "Play" icon below the YouTube player to start sharing tab audio.
- **Participant**: Join the room and click "Start Listening" to sync audio playback.

## Project Notes

- `PROJECT_CONTEXT.md`: Living implementation status and architectural details.
- `Votify_V2_Architecture.md`: High-level product roadmap and original vision.
- `supabase-schema-v2.sql`: Current database source of truth.
- A host can have one active room and multiple paused rooms.
