# livekit-token

Creates short-lived LiveKit room tokens for Votify Listen Together rooms.

Required Supabase function secrets:

```bash
supabase secrets set LIVEKIT_API_KEY=your_key
supabase secrets set LIVEKIT_API_SECRET=your_secret
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase in hosted Edge Functions.

Deploy:

```bash
supabase functions deploy livekit-token
```
