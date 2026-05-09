import { createClient } from 'npm:@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
    const livekitApiKey = Deno.env.get('LIVEKIT_API_KEY');
    const livekitApiSecret = Deno.env.get('LIVEKIT_API_SECRET');

    if (!supabaseUrl || !supabaseKey || !livekitApiKey || !livekitApiSecret) {
      return json({ error: 'LiveKit token function is not configured.' }, 500);
    }

    const { roomCode, participantId, displayName, isHost } = await req.json();
    const code = String(roomCode || '').trim().toUpperCase();
    const identity = String(participantId || '').trim();
    const name = String(displayName || (isHost ? 'Host' : 'Guest')).trim().slice(0, 64);

    if (!code || !identity) {
      return json({ error: 'roomCode and participantId are required.' }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      global: {
        headers: req.headers.get('Authorization')
          ? { Authorization: req.headers.get('Authorization')! }
          : {},
      },
    });

    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, code, host_id, mode, status, livekit_room_name')
      .eq('code', code)
      .in('status', ['active', 'paused'])
      .maybeSingle();

    if (roomError) throw roomError;
    if (!room) return json({ error: 'Room not found.' }, 404);
    if (room.mode !== 'listen_together') {
      return json({ error: 'This room is not a Listen Together room.' }, 400);
    }

    if (isHost) {
      const authHeader = req.headers.get('Authorization') || '';
      const jwt = authHeader.replace(/^Bearer\s+/i, '');
      const { data: userData, error: userError } = await supabase.auth.getUser(jwt);

      if (userError || !userData.user || userData.user.id !== room.host_id) {
        return json({ error: 'Only the room host can publish audio.' }, 403);
      }
    }

    const livekitRoomName = room.livekit_room_name || room.code;
    const token = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: sanitizeIdentity(identity),
      name,
      ttl: '2h',
    });

    token.addGrant({
      room: livekitRoomName,
      roomJoin: true,
      canPublish: Boolean(isHost),
      canSubscribe: true,
      canPublishData: Boolean(isHost),
    });

    return json({
      token: await token.toJwt(),
      livekitRoomName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create LiveKit token.';
    console.error('[livekit-token]', err);
    return json({ error: message }, 500);
  }
});

function sanitizeIdentity(value: string) {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 96);
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
