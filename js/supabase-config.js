import { createClient } from '@supabase/supabase-js';

// ============================================================
//  🔧 SUPABASE CONFIGURATION
// ============================================================
//  Credentials are loaded from environment variables (.env file).
//  See .env.example for the required variables.
// ============================================================

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    '[Votify] Missing Supabase credentials. Copy .env.example to .env and fill in your values.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
