import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** The browser's Supabase client, or null when this deployment has no Supabase project configured. */
let client: SupabaseClient | null | undefined;
export function supabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  client = url && anon ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } }) : null;
  return client;
}
export const supabaseConfigured = () => !!(url && anon);
export const devAuthEnabled = () => process.env.NEXT_PUBLIC_DEV_AUTH === '1';
