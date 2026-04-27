# 🎧 Votify

> Real-time, crowd-controlled YouTube music queue for live events.
> Attendees scan a QR code, search for songs, and vote their favorites to the top — all projected live on screen.

---

## 🚀 Quick Start

### 1. Set Up Supabase (5 minutes)

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Click **"New Project"** — give it any name (e.g., `votify`), set a password, choose a region
3. Wait for the project to finish provisioning (~1 minute)

#### Run the Database Schema

4. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
5. Click **"New Query"**
6. Copy the entire contents of [`supabase-schema.sql`](./supabase-schema.sql) and paste it in
7. Click **"Run"** — you should see "Success" for each statement

#### Enable Realtime

8. Go to **Database → Replication** (left sidebar)
9. Find the `queue` table and make sure **Realtime** is toggled **ON**

#### Get Your API Keys

10. Go to **Project Settings → API** (left sidebar → gear icon)
11. Copy these two values:
    - **Project URL** → looks like `https://abcdefg.supabase.co`
    - **anon / public key** → a long string starting with `eyJ...`

### 2. Configure Votify

12. Open `js/supabase-config.js` in your editor
13. Replace the placeholder values:

```js
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';     // ← paste your Project URL
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';             // ← paste your anon key
```

### 3. Install & Run

```bash
npm install
npm run dev
```

The app opens at `http://localhost:3000`. Your **local network IP** (e.g., `http://192.168.x.x:3000`) will also be displayed in the terminal — this is what phones on the same Wi-Fi can use.

---

## 🖥️ Usage

| Screen | URL | Purpose |
|--------|-----|---------|
| **Landing** | `/` | Choose Host or Participant mode |
| **Host** | `/host_6969.html` | Projector view — YouTube player + QR code + live queue |
| **Participant** | `/participant.html` | Mobile view — Search, Add songs, Upvote |

## 🚀 How to Run

1. Open `http://localhost:3000/host_6969.html` on the machine connected to the projector
2. The QR code auto-generates pointing to the participant page
3. Songs auto-play from the queue (highest votes first)
4. When a song ends, the next highest-voted song plays automatically

### Participant Mode (Phone)
1. Scan the QR code (or navigate to the participant URL)
2. Search for any song
3. Tap a result to add it to the queue
4. If it's already in the queue, your tap counts as an upvote
5. Watch the queue re-order in real time!

---

## 🛠️ Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS
- **Backend:** Supabase (PostgreSQL + Realtime)
- **Search:** Invidious API (open-source, no API key needed)
- **Playback:** YouTube IFrame Player API
- **QR Code:** qrcode.js
- **Dev Server:** Vite

---

## 📋 Pre-Event Checklist

- [ ] Supabase project created and schema applied
- [ ] `supabase-config.js` updated with real credentials
- [ ] Host screen tested — YouTube player loads and autoplays
- [ ] QR code scanned from phone — participant page loads
- [ ] Both screens update in real time
- [ ] Anti-spam working (can't vote same song twice)
- [ ] Wi-Fi confirmed — all devices on the same network
- [ ] Projector + speakers connected and tested

---

*Built for NEXORA Vibe Coding 🎶*
