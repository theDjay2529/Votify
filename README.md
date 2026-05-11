# Votify V2

Votify is a real-time, crowd-controlled YouTube music queue. A host creates a room, participants join by room code or QR link, and everyone votes the queue together.

The platform offers two modes:
- **Queue Room**: Classic mode where one central screen plays the music, and everyone controls it.
- **Listen Together (Silent Disco)**: The host controls playback, and every participant's device plays the same YouTube video perfectly synchronized via clock-synced state broadcasts.

## Tech Stack

- **Frontend**: Vanilla HTML, CSS, and ES modules
- **Build tool**: Vite
- **Backend**: Supabase Auth, Postgres, RLS, and Realtime
- **Hosting**: Vercel (Production)
- **Playback**: YouTube IFrame Player API
- **Search**: Piped API with Invidious fallback

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
3. Create a local `.env` file in the project root.
4. Add your environment values:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_DEPLOYED_URL=https://your-site.vercel.app
```

5. Install and run:

```bash
npm install
npm run dev
```

The dev server runs at `http://localhost:3000`.

## Production Deployment (Vercel)

Votify V2 is designed to run on Vercel as a pure static site.

1. **GitHub Sync**: Connect your repository to Vercel.
2. **Environment Variables**: Add all the variables from the `.env` section above to the Vercel Dashboard (Settings > Environment Variables).
3. **Branch**: Ensure your `Production Branch` is set to `V2` (Settings > Git).
4. **Supabase Auth**: Add your Vercel URL (e.g., `https://votifyv2.vercel.app`) to your Supabase Project Settings > Auth > URL Configuration > Site URL and Redirect URIs.

## Listen Together (Silent Disco)

To overcome the limitations of WebRTC and mobile browser audio-capture restrictions, Votify uses a "Silent Disco" state-sync architecture:

- **Host**: The host's player periodically broadcasts `sync_playback` messages to the Supabase Realtime channel, containing the current playback timestamp and status.
- **Participant**: Participants click "Start Listening" to initialize a hidden YouTube player. The player listens to the host's sync messages and seeks its local timeline to match the exact expected playback position.
- **Zero Server Cost**: This completely eliminates the need for expensive audio streaming servers like LiveKit.

## Project Notes

- `PROJECT_CONTEXT.md`: Living implementation status and architectural details.
- `Votify_V2_Architecture.md`: High-level product roadmap and original vision.
- `supabase-schema-v2.sql`: Current database source of truth.

![](https://komarev.com/ghpvc/?username=theDjay2529)

