# 🎧 Vibe Coding Build: Supabase × YouTube Queue System

> A real-time, crowd-controlled music queue for hackathon/event environments. Attendees scan a QR code, search YouTube, and vote songs up the queue — all projected live on screen.

---

## 🏗️ Architecture Overview

```
[Participant Phone]  ──→  [Supabase DB]  ←──  [Host Screen / Projector]
     Mobile Web UI           Realtime            YouTube IFrame Player
  (search + vote)          PostgreSQL           (auto-plays top song)
```

**Tech Stack:**
- **Backend:** Supabase (PostgreSQL + Realtime + RPC functions)
- **Music Playback:** YouTube IFrame Player API (via Brave browser, no extra cost)
- **Search:** YouTube Data API v3 (Google Cloud Console)
- **Frontend:** Vanilla JS or a lightweight framework — two separate UIs (Host + Participant)

---

## 📋 Step-by-Step Build Plan

---

### Step 1 — Supabase: Database & Backend Logic

Head to [supabase.com](https://supabase.com), create a new project, and open the **SQL Editor**. Run the following in one go:

```sql
-- 1. Create the queue table
CREATE TABLE queue (
  id              UUID      DEFAULT uuid_generate_v4() PRIMARY KEY,
  youtube_id      TEXT      NOT NULL,
  title           TEXT      NOT NULL,
  thumbnail_url   TEXT,
  votes           INTEGER   DEFAULT 1,
  played          BOOLEAN   DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- 2. Enable Realtime on the queue table
ALTER PUBLICATION supabase_realtime ADD TABLE queue;

-- 3. Atomic upvote function (prevents race conditions on concurrent votes)
CREATE OR REPLACE FUNCTION increment_vote(row_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE queue SET votes = votes + 1 WHERE id = row_id;
END;
$$ LANGUAGE plpgsql;
```

**Why the RPC function?** Direct `UPDATE votes = votes + 1` from multiple clients at the same millisecond can cause lost updates. The function runs atomically inside the DB, so every vote counts.

**Supabase Dashboard settings to verify:**
- [ ] Realtime is enabled for the `queue` table (Database → Replication)
- [ ] Row Level Security (RLS) is either disabled for the event, or you've added permissive policies for public read/write

---

### Step 2 — YouTube Search API Setup

You need search capability so participants can find songs from their phones.

**Setup:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project → Enable **YouTube Data API v3**
3. Generate an **API Key** (restrict it to HTTP referrers in production)

**Search Endpoint:**

```
GET https://www.googleapis.com/youtube/v3/search
  ?part=snippet
  &q={USER_SEARCH_QUERY}
  &type=video
  &videoCategoryId=10        ← Music category only (filters out vlogs/tutorials)
  &maxResults=8
  &key={YOUR_API_KEY}
```

**Response fields you need from each result:**
- `id.videoId` → stored as `youtube_id`
- `snippet.title` → stored as `title`
- `snippet.thumbnails.medium.url` → stored as `thumbnail_url`

> ⚠️ **Quota note:** The free tier gives 10,000 units/day. Each search costs 100 units (~100 searches/day). For a short event this is fine, but add an error fallback (see Step 6).

---

### Step 3 — Host Screen (Projector View)

This page runs in **Brave browser** connected to the projector and speakers. It has one job: play the right song and stay in sync with the audience's votes.

#### UI Layout

```
┌─────────────────────────────────────────────────────┐
│  [QR CODE]          NOW PLAYING                      │
│                     ┌─────────────────────────────┐  │
│  Scan to join →     │   YouTube IFrame Player     │  │
│                     │   (fullscreen/large)        │  │
│  ─────────────────  └─────────────────────────────┘  │
│  UP NEXT:                                            │
│  1. Song Title A  ▲ 24 votes                        │
│  2. Song Title B  ▲ 17 votes                        │
│  3. Song Title C  ▲ 9 votes                         │
└─────────────────────────────────────────────────────┘
```

#### Playback Logic Loop

```
1. Query Supabase:
   SELECT * FROM queue
   WHERE played = false
   ORDER BY votes DESC
   LIMIT 1

2. Load youtube_id into the IFrame Player

3. Listen for player state change:
   YT.PlayerState.ENDED → {
     UPDATE queue SET played = true WHERE id = current_song_id
     Re-run step 1 (auto-play next top song)
   }
```

#### Realtime Sync (Up Next List)

```js
supabase
  .channel('queue-updates')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'queue',
    filter: 'played=eq.false'
  }, (payload) => {
    // Re-fetch and re-render the "Up Next" top 3 list
    refreshUpNextDisplay();
  })
  .subscribe();
```

---

### Step 4 — Participant Screen (Mobile Web)

This is what loads when attendees scan the QR code. Keep the UI minimal and thumb-friendly — they're standing at a hackathon, not at a desk.

#### Core User Flow

```
[Search bar] → [Results list with thumbnails]
                         ↓ tap a song
          Is youtube_id already in queue (played = false)?
               /                        \
             YES                        NO
              ↓                          ↓
   Call increment_vote(id)     INSERT new row into queue
   via Supabase RPC            { youtube_id, title, thumbnail_url, votes: 1 }
```

#### Realtime Queue Display

```js
supabase
  .channel('participant-queue')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'queue',
    filter: 'played=eq.false'
  }, () => {
    // Re-fetch and sort by votes descending
    // Re-render queue list on screen
    refreshQueueDisplay();
  })
  .subscribe();
```

The list re-orders itself live — attendees can watch their song climb the ranks in real time.

#### Anti-Spam: Duplicate Vote Prevention

Use `localStorage` to track what the user has already voted for:

```js
const voted = JSON.parse(localStorage.getItem('voted_ids') || '[]');

function handleVote(youtubeId) {
  if (voted.includes(youtubeId)) {
    showToast("You already hyped this track! 🔥");
    return;
  }
  // proceed with vote...
  voted.push(youtubeId);
  localStorage.setItem('voted_ids', JSON.stringify(voted));
}
```

---

### Step 5 — QR Code Generation

The QR code on the Host Screen should point to your Participant Screen URL. You can generate it dynamically using a free library like `qrcode.js` or a static image from [qr-code-generator.com](https://www.qr-code-generator.com).

**Tip:** If you're running this locally (e.g. `localhost:3000`), use your machine's **local network IP** (e.g. `192.168.x.x:3000`) in the QR code so phones on the same Wi-Fi can connect.

---

### Step 6 — Polish & Error Handling

#### Styling
- Dark mode with neon accents (deep black background, electric green or purple highlights)
- Large tap targets on mobile (minimum 48×48px buttons)
- Song thumbnails should be prominent in search results

#### Loading States
- Skeleton loaders for search results (show placeholder cards while the API responds)
- Spinner or pulse animation when a song is being added to the queue

#### Error Handling
- **YouTube API quota exceeded (403):** Catch the error and show a toast — `"Search is taking a break — try again in a bit! 🎵"` — and hide the search bar gracefully
- **No songs in queue:** Host screen should show a friendly idle screen with the QR code prominent and a message like `"Be the first to add a song!"`
- **Supabase connection drop:** Show a banner `"Reconnecting..."` and retry the subscription

---

## ✅ Pre-Event Checklist

- [ ] Supabase project created, SQL schema applied, Realtime enabled
- [ ] YouTube Data API v3 key generated and tested
- [ ] Host screen tested in Brave — IFrame player loads and autoplays
- [ ] Participant screen QR code points to correct local/public URL
- [ ] Both screens subscribed to Realtime and updating live
- [ ] Anti-spam localStorage logic working
- [ ] YouTube quota fallback toast working
- [ ] Wi-Fi confirmed — Host and participant devices on the same network (if local)
- [ ] Projector and audio output tested on the Host machine

---

## 🚀 Deployment Options

| Option | Best For | Notes |
|---|---|---|
| `localhost` + local IP in QR | Single-venue, same Wi-Fi | Zero cost, fastest setup |
| Vercel / Netlify | Public deployment | Free tier, easy CI |
| Cloudflare Pages | Public deployment | Free, fast global CDN |

For a hackathon weekend build, **localhost + local IP** is the fastest path. Deploy to Vercel after if you want to share it beyond the event.

---

*Built for NEXORA Vibe Coding — ship it by the weekend. 🎶*
