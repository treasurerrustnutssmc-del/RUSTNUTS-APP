import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, USE_LIVE_DATA } from './config';
import type { Database } from './database.types';
import { appMode } from './reviewMode';

let client: SupabaseClient<Database> | null = null;

/** The club database connection. Only exists in a live build. */
export function supabase(): SupabaseClient<Database> {
  if (!USE_LIVE_DATA) throw new Error('The live database is not set up in this build.');
  // Store review demo: the reviewers never reach the live club, whatever a screen asks for.
  if (appMode.reviewing()) throw new Error('The live database is off in the review demo.');
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

export { friendlyError } from './friendlyError';
