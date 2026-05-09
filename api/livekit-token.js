

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const { AccessToken } = await import('livekit-server-sdk');
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!supabaseUrl || !supabaseKey || !apiKey || !apiSecret) {
      return res.status(500).json({ error: 'LiveKit token function is not configured on Vercel.' });
    }

    const { roomCode, participantId, displayName, isHost } = req.body;
    const code = String(roomCode || '').trim().toUpperCase();
    const identity = String(participantId || '').trim();
    const name = String(displayName || (isHost ? 'Host' : 'Guest')).trim().slice(0, 64);

    if (!code || !identity) {
      return res.status(400).json({ error: 'roomCode and participantId are required.' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, code, host_id, mode, status, livekit_room_name')
      .eq('code', code)
      .in('status', ['active', 'paused'])
      .maybeSingle();

    if (roomError) throw roomError;
    if (!room) return res.status(404).json({ error: 'Room not found.' });

    if (room.mode !== 'listen_together') {
      return res.status(400).json({ error: 'This room is not a Listen Together room.' });
    }

    if (isHost) {
      const authHeader = req.headers.authorization || '';
      const jwt = authHeader.replace(/^Bearer\s+/i, '');
      const { data: userData, error: userError } = await supabase.auth.getUser(jwt);

      if (userError || !userData.user || userData.user.id !== room.host_id) {
        return res.status(403).json({ error: 'Only the room host can publish audio.' });
      }
    }

    const livekitRoomName = room.livekit_room_name || room.code;
    const at = new AccessToken(apiKey, apiSecret, {
      identity: identity.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 96),
      name,
      ttl: '2h',
    });

    at.addGrant({
      room: livekitRoomName,
      roomJoin: true,
      canPublish: !!isHost,
      canSubscribe: true,
      canPublishData: !!isHost,
    });

    return res.status(200).json({
      token: await at.toJwt(),
      livekitRoomName,
    });
  } catch (err) {
    console.error('[livekit-token]', err);
    return res.status(500).json({ error: err.message || 'Failed to create LiveKit token.' });
  }
}
