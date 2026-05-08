# 🎧 Votify

> **A real-time, crowd-controlled music queue and synchronized listening platform.**
> 
> Votify lets anyone host a live music session where attendees can scan a QR code, search for songs, and vote their favorites to the top. From live event projector screens to synchronized "Listen Together" sessions, Votify brings people together through music.

---

## 🌟 Features & The V2 Vision

Votify is evolving from a single-session event tool into a **multi-room, cross-platform product**:

- **Multi-Room Architecture**: Hosts can authenticate and create their own isolated rooms with unique 6-character invite codes.
- **Queue Room Mode**: The classic experience. One projector plays the queue, the crowd votes from their phones.
- **Listen Together Mode**: The host's device streams audio via WebRTC (LiveKit) directly to all participants simultaneously. Everyone hears the music through their own device, perfectly in sync.
- **Advanced Voting**: Reddit-style upvoting/downvoting and a democratic skip-vote system.
- **Participant Moderation**: Hosts can view participant activity, ban abusive users, and manage the room.
- **Native Flutter App & Android Auto**: A dedicated Android app that allows hosts to control the queue directly from their car dashboard while streaming to passengers.

*(Note: We are actively building out this V2 architecture. See [`Votify_V2_Architecture.md`](./Votify_V2_Architecture.md) and [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) for full implementation details).*

---

## 🛠️ Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS (Migrating to V2 architecture)
- **Native App:** Flutter (Upcoming)
- **Backend:** Supabase (PostgreSQL + Realtime + Auth)
- **Search:** Piped & Invidious APIs (open-source fallback chain)
- **WebRTC (Listen Together):** LiveKit SFU
- **Dev Server:** Vite

---

## 🚀 Quick Start (Current Developer Setup)

### 1. Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. In your Supabase dashboard, go to **SQL Editor** and run the contents of [`supabase-schema.sql`](./supabase-schema.sql).
3. Go to **Database → Replication** and enable **Realtime** for the `queue` table.
4. From **Project Settings → API**, copy your **Project URL** and **anon/public key**.

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

### 3. Install & Run

```bash
npm install
npm run dev
```

The app opens at `http://localhost:3000`. You can test the host screen and use another device on your local network to act as a participant.
