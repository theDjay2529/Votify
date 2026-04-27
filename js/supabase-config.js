import { createClient } from '@supabase/supabase-js';

// ============================================================
//  🔧 SUPABASE CONFIGURATION — REPLACE THESE PLACEHOLDERS
// ============================================================
// 1. Go to https://supabase.com → Create a new project
// 2. Go to Project Settings → API
// 3. Copy the "Project URL" and "anon / public" key below
// ============================================================

const SUPABASE_URL = 'https://YOUR_SUPABASE_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
