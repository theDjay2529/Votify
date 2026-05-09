import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AccessToken } from 'livekit-server-sdk';
import { createClient } from '@supabase/supabase-js';

loadEnv('.env');
loadEnv('supabase/.env.local');

const PORT = Number(process.env.VOTIFY_TOKEN_DEV_PORT || 54321);
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const livekitApiKey = process.env.LIVEKIT_API_KEY;
const livekitApiSecret = process.env.LIVEKIT_API_SECRET;

if (!supabaseUrl || !supabaseKey || !livekitApiKey || !livekitApiSecret) {
  console.error('Missing SUPABASE_URL/SUPABASE_ANON_KEY/LIVEKIT_API_KEY/LIVEKIT_API_SECRET.');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/functions/v1/livekit-token') {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }

  try {
    const body = await readJson(req);
    const roomCode = String(body.roomCode || '').trim().toUpperCase();
    const participantId = String(body.participantId || '').trim();
    const displayName = String(body.displayName || (body.isHost ? 'Host' : 'Guest')).trim().slice(0, 64);

    if (!roomCode || !participantId) {
      sendJson(res, 400, { error: 'roomCode and participantId are required.' });
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      global: {
        headers: req.headers.authorization
          ? { Authorization: req.headers.authorization }
          : {},
      },
    });

    const { data: room, error } = await supabase
      .from('rooms')
      .select('id, code, host_id, mode, status, livekit_room_name')
      .eq('code', roomCode)
      .in('status', ['active', 'paused'])
      .maybeSingle();

    if (error) throw error;
    if (!room) {
      sendJson(res, 404, { error: 'Room not found.' });
      return;
    }
    if (room.mode !== 'listen_together') {
      sendJson(res, 400, { error: 'This room is not a Listen Together room.' });
      return;
    }

    if (body.isHost) {
      const authHeader = req.headers.authorization || '';
      const jwt = authHeader.replace(/^Bearer\s+/i, '');
      const { data: userData, error: userError } = await supabase.auth.getUser(jwt);

      if (userError || !userData.user || userData.user.id !== room.host_id) {
        sendJson(res, 403, { error: 'Only the room host can publish audio.' });
        return;
      }
    }

    const token = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: sanitizeIdentity(participantId),
      name: displayName,
      ttl: '2h',
    });
    token.addGrant({
      room: room.livekit_room_name || room.code,
      roomJoin: true,
      canPublish: Boolean(body.isHost),
      canSubscribe: true,
      canPublishData: Boolean(body.isHost),
    });

    sendJson(res, 200, {
      token: await token.toJwt(),
      livekitRoomName: room.livekit_room_name || room.code,
    });
  } catch (err) {
    console.error('[livekit-token-dev]', err);
    sendJson(res, 500, { error: err instanceof Error ? err.message : 'Failed to create token.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Votify local LiveKit token server listening at http://127.0.0.1:${PORT}/functions/v1`);
});

function loadEnv(path) {
  const file = resolve(path);
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function readJson(req) {
  return new Promise((resolveJson, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolveJson(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function sanitizeIdentity(value) {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 96);
}
