<div align="center">

# 🎧 Votify

**Your crowd controls the music.**

Real-time, crowd-controlled YouTube music queue for parties, events, and live sessions.
Everyone votes — the best songs rise to the top.

[![Live Demo](https://img.shields.io/badge/Live_Demo-votify--delta.vercel.app-7c3aed?style=for-the-badge&logo=vercel)](https://votify-delta.vercel.app)
[![License](https://img.shields.io/badge/License-Apache_2.0-38bdf8?style=for-the-badge)](LICENSE)
[![Supabase](https://img.shields.io/badge/Backend-Supabase-3ECF8E?style=for-the-badge&logo=supabase)](https://supabase.com)

</div>

---

## What is Votify?
**Votify is a real-time, crowd-controlled music platform that puts your audience in charge of the vibe.** 

*No app installs required. No registration needed to participate (you only need to login if you want to HOST a room).*

---
## Services Offered:
### 📺 Queue Mode (The Big Screen Experience)
Votify lets a host start a music session and display it on a big screen (like a TV or projector). Participants join from their phones using a simple room code, search YouTube for songs, add them to the queue, and vote songs up or down in real time. The crowd decides what plays next!

‎ 
### 🎶 Listen Together Mode (Multi-Device Sync 🎧🔊)
Votify features a synchronized **Listen Together** mode that lets you play songs on multiple devices in perfect, real-time sync.

* **Long-Distance Jams:**
You and your friends across different countries can listen to the exact same queue at the exact same second.

* **No Bluetooth Speaker? No Problem!**
Forgot a speaker for a party or jam session? Don't worry—just have everyone join the room. Every phone speaker will play the music in sync, combining forces to make up for the missing speaker!

---

## Features

| Feature | Description |
|---|---|
| 🗳️ **Live Voting** | Upvote and downvote songs. The queue sorts by votes automatically in real time. |
| 📱 **Phone Remote** | Participants control the queue entirely from their phones. |
| 🔍 **YouTube Search** | Search YouTube directly inside the app via Piped API (no YouTube API key needed). |
| 🔐 **PIN Protection** | Hosts can optionally lock rooms with a PIN. |
| 🚫 **Moderation** | Hosts can kick and ban participants from the session. |
| ⏸️ **Pause & Resume** | Hosts can pause a room and come back later without losing queue state. |
| 🔗 **QR Code Join** | Auto-generated QR code for instant participant joining. |
| 🎶 **Listen Together** | Silent Disco mode — participants sync audio playback locally, host controls state. |
| ⚡ **Real-time Sync** | All queue and vote changes push to every connected device instantly via Supabase Realtime. |

---

## Tech Stack

- **Frontend** — Vanilla HTML, CSS, and ES Modules (no framework)
- **Build** — [Vite](https://vitejs.dev)
- **Backend** — [Supabase](https://supabase.com) (Postgres + Auth + RLS + Realtime)
- **Hosting** — [Netlify](https://netlify.com) with Netlify Functions
- **Playback** — YouTube IFrame Player API
- **Search** — [Piped API](https://github.com/TeamPiped/Piped) (privacy-friendly YouTube proxy, no API key required)

---

## Project Structure

```
votify/
├── index.html          # Landing page (Join / Host entry point)
├── auth.html           # Host login (Google OAuth + username/password)
├── home.html           # Host dashboard & room creation
├── host.html           # Host playback screen (the "big screen")
├── join.html           # Participant room code entry
├── participant.html    # Participant remote controller
│
├── js/
│   ├── supabase-config.js   # Supabase client initialisation
│   ├── auth.js              # Auth helpers, session guards, guest tokens
│   ├── auth-page.js         # Login/signup page logic
│   ├── rooms.js             # Room lifecycle (create, pause, delete, ban)
│   ├── voting.js            # Vote casting RPCs and local vote state
│   ├── home.js              # Dashboard logic
│   ├── host.js              # Full host playback + moderation logic
│   ├── join.js              # Room join flow (code → PIN → identity)
│   └── participant.js       # Participant queue, voting, and search logic
│
├── css/                # Per-page stylesheets + global design tokens
├── netlify/functions/  # Serverless function (LiveKit token endpoint)
├── supabase-schema-v2.sql   # Full database schema with RLS policies
└── netlify.toml        # Build config + HTTP security headers
```

---

## How it Works

```
Host opens Votify → Creates a room → Displays host screen on TV/projector
        │
        └──► Shares room code or QR link with the crowd
                        │
                        └──► Participants open link on phone
                                    │
                                    ├── Search YouTube
                                    ├── Add songs to queue
                                    ├── Vote songs up/down
                                    └── Queue reorders in real time on all screens
```

All state (queue, votes, participants) is stored in **Supabase Postgres** and streamed to every connected client via **Supabase Realtime** channels. Row Level Security (RLS) ensures participants can only do what they're supposed to — no server-side code needed for most operations.

---

## Local Setup

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- A free [Supabase](https://supabase.com) account

### Steps

**1. Clone the repository**
```bash
git clone https://github.com/theDjay2529/Votify.git
cd Votify
```

**2. Set up the database**

In your Supabase project, go to **SQL Editor → New Query**, paste the contents of `supabase-schema-v2.sql`, and click **Run**.

**3. Configure environment variables**

Create a `.env` file in the project root:
```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_DEPLOYED_URL=http://localhost:3000
```

Get these values from **Supabase → Project Settings → API**.

**4. Install and run**
```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

---

## Deployment (Netlify)

1. Push the repo to GitHub.
2. Connect the repository to [Netlify](https://netlify.com).
3. Set the following environment variables in **Netlify → Site settings → Environment variables**:

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key |
| `VITE_DEPLOYED_URL` | Your Netlify site URL (e.g. `https://votify-delta.vercel.app`) |

4. Deploy. Netlify runs `npm run build` and publishes the `dist/` folder automatically.
5. In **Supabase → Authentication → URL Configuration**, add your Netlify URL as the Site URL and add it as an allowed Redirect URI.
6. In **Supabase → Authentication → Providers → Google**, enable Google and add your Google OAuth credentials (from [Google Cloud Console](https://console.cloud.google.com)).

---

## Database Schema

The full schema is in [`supabase-schema-v2.sql`](supabase-schema-v2.sql). Key tables:

| Table | Purpose |
|---|---|
| `profiles` | Host accounts (linked to Supabase Auth) |
| `rooms` | Room metadata (code, name, mode, PIN, status) |
| `queue` | Songs in a room's queue with vote counts |
| `votes_cast` | Per-participant vote records (deduplication) |
| `skip_votes` | Per-participant skip votes |
| `room_participants` | Presence tracking for active participants |
| `room_bans` | Banned participant tokens per room |

**Row Level Security is enabled on every table.** Participants can only read/write within rooms they have joined. All vote mutations go through `SECURITY DEFINER` RPCs to prevent direct vote count manipulation.

---

## Security

- All credentials are stored as environment variables — never in source code.
- The Supabase `anon` key is intentionally public; all data access is gated by RLS policies.
- Participant identity is tracked via a persistent UUID in `localStorage` — this is a presence token, not an authentication boundary.
- HTTP security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) are enforced via `netlify.toml`.
- All user-controlled strings are HTML-escaped before rendering to prevent XSS.

---

## Contributing

Pull requests are welcome. For major changes please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/your-idea`)
3. Commit your changes
4. Push and open a pull request against `main`

---

## License

[Apache License 2.0](LICENSE) — free to use, modify, and self-host.

---

<div align="center">
  <sub>Built with ❤️ for live music sessions · Powered by Supabase + Netlify</sub>
</div>
