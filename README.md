# Votify V2

Votify V2 is a real-time, crowd-controlled YouTube music queue built for shared listening experiences.
A host creates a room, participants join by room code or QR link, and everyone votes the queue together.

## Features

- **Queue Room**: one central playback screen managed by the host, with room-wide queue voting.
- **Listen Together (Silent Disco)**: participants play synchronized YouTube audio locally while the host controls playback state.
- **Live voting**: add, reorder, and vote songs in real time.
- **Supabase backend**: Auth, Postgres, RLS, and Realtime for fast state sync.
- **Static-first deployment**: optimized for Vercel with no dedicated server required.

## Tech Stack

- Frontend: Vanilla HTML, CSS, and ES modules
- Build tool: Vite
- Backend: Supabase Auth, Postgres, Realtime, and Row-Level Security
- Playback: YouTube IFrame Player API
- Search: Piped API with Invidious fallback

## Project Layout

- `index.html` — public landing page
- `auth.html` — host authentication and profile setup
- `home.html` — dashboard and room creation
- `host.html` — host playback/projector screen
- `join.html` — participant room code entry
- `participant.html` — participant remote controller

## Local Setup

1. Create a [Supabase](https://supabase.com) project.
2. Run the database schema in the Supabase SQL Editor:
   ```
   supabase-schema-v2.sql
   ```
3. Create a `.env` file in the project root with these values:
   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
   VITE_DEPLOYED_URL=https://your-site.netlify.app
   VITE_LIVEKIT_URL=wss://YOUR_PROJECT.livekit.cloud
   ```
4. *(Listen Together only)* Create `supabase/.env.local` with:
   ```env
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   LIVEKIT_API_KEY=...
   LIVEKIT_API_SECRET=...
   ```
5. Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## Deployment

Votify V2 is optimized for static deployment on Vercel.

1. Connect the repository to Vercel.
2. Add the same environment variables from `.env` in the Vercel dashboard.
3. Configure the production branch and deploy.
4. In Supabase Auth settings, add your deployed site URL and redirect URI.

## Listen Together (Silent Disco)

This mode avoids audio-streaming servers by synchronizing playback state instead of audio:

- Host broadcasts playback state updates through Supabase Realtime.
- Participants start a hidden local YouTube player and follow the host’s sync timeline.
- This keeps playback aligned across devices without server-side audio streaming.

## Important Files

- `supabase-schema-v2.sql` — database schema, tables, and RLS policies
- `PROJECT_CONTEXT.md` — implementation notes and phase status
- `Votify_V2_Architecture.md` — project vision and architecture

---

Built for fast crowd-sourced music sessions with modern static hosting and real-time sync.
