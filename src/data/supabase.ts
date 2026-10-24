import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, USE_LIVE_DATA } from './config';
import type { Database } from './database.types';

let client: SupabaseClient<Database> | null = null;

/** The club database connection. Only exists in a live build. */
export function supabase(): SupabaseClient<Database> {
  if (!USE_LIVE_DATA) throw new Error('The live database is not set up in this build.');
  if (!client) {
    client = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    // Phones pause the app in the background; keep the sign-in fresh only while it's open.
    if (Platform.OS !== 'web') {
      AppState.addEventListener('change', (state) => {
        if (state === 'active') client?.auth.startAutoRefresh();
        else client?.auth.stopAutoRefresh();
      });
    }
  }
  return client;
}

/** Turns database errors into something a member can act on. */
export function friendlyError(error: { message?: string; code?: string } | null | undefined): Error {
  const msg = error?.message ?? 'Something went wrong. Try again.';
  if (error?.code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return new Error("You're not allowed to do that.");
  }
  if (error?.code === '23505') return new Error('That’s already taken. Refresh and try again.');
  if (/network|fetch/i.test(msg)) return new Error('No connection. Check your signal and try again.');
  if (/token has expired|invalid/i.test(msg) && /otp|token/i.test(msg)) {
    return new Error('That code didn’t work. Check it, or ask for a new one.');
  }
  return new Error(msg);
}
