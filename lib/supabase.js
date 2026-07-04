/**
 * Supabase Client Singleton
 * 
 * Reads SUPABASE_URL and SUPABASE_ANON_KEY from environment variables.
 * Set these in EdgeOne Pages → Environment Variables.
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

let supabase = null;

function getClient() {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error(
        '[Supabase] SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required.\n' +
        '请在 EdgeOne Pages 控制台设置这两个环境变量。'
      );
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    console.log('[Supabase] Client initialized');
  }
  return supabase;
}

module.exports = { getClient };
