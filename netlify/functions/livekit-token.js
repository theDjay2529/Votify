import { createClient } from '@supabase/supabase-js';
import { AccessToken } from 'livekit-server-sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const handler = async (event) => {
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: 'ok',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const livekitApiKey = process.env.VITE_LIVEKIT_URL ? process.env.LIVEKIT_API_KEY : null; // We might want to pass these directly
    const livekitApiSecret = process.env.LIVEKIT_API_SECRET;

    // LiveKit URL from env is usually the WebSocket URL, we need the API Key and Secret
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!supabaseUrl || !supabaseKey || !apiKey || !apiSecret) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'LiveKit token function is not configured on Netlify.' }),
      };
    }

    const { roomCode, participantId, displayName, isHost } = JSON.parse(event.body);
    const code = String(roomCode || '').trim().toUpperCase();
    const identity = String(participantId || '').trim();
    const name = String(displayName || (isHost ? 'Host' : 'Guest')).trim().slice(0, 64);

    if (!code || !identity) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'roomCode and participantId are required.' }),
      };
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    // Verify room
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, code, host_id, mode, status, livekit_room_name')
      .eq('code', code)
      .in('status', ['active', 'paused'])
      .maybeSingle();

    if (roomError) throw roomError;
    if (!room) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Room not found.' }),
      };
    }

    if (room.mode !== 'listen_together') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'This room is not a Listen Together room.' }),
      };
    }

    // Host verification if needed
    if (isHost) {
      const authHeader = event.headers.authorization || '';
      const jwt = authHeader.replace(/^Bearer\s+/i, '');
      const { data: userData, error: userError } = await supabase.auth.getUser(jwt);

      if (userError || !userData.user || userData.user.id !== room.host_id) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Only the room host can publish audio.' }),
        };
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

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: await at.toJwt(),
        livekitRoomName,
      }),
    };
  } catch (err) {
    console.error('[livekit-token]', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message || 'Failed to create LiveKit token.' }),
    };
  }
};
