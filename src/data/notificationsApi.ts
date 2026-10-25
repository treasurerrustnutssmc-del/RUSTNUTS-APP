// Reading and saving the signed-in member's notification settings (live mode).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationPrefs } from '../domain/types';
import type { Database } from './database.types';
import { friendlyError } from './friendlyError';

/** Their saved settings, or null when they've never changed them (the app then uses the defaults). */
export async function loadNotificationPrefs(db: SupabaseClient<Database>): Promise<NotificationPrefs | null> {
  // RLS returns only the caller's own row.
  const { data, error } = await db.from('notification_prefs').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    rideReminders: data.ride_reminders,
    rideChanges: data.ride_changes,
    newRides: data.new_rides,
    approvals: data.approvals,
    // Missing until rev-sound.sql is live: the rev is on.
    revSound: data.rev_sound ?? true,
  };
}

export async function saveNotificationPrefs(db: SupabaseClient<Database>, prefs: NotificationPrefs): Promise<void> {
  const { error } = await db.rpc('save_notification_prefs', {
    p_ride_reminders: prefs.rideReminders,
    p_ride_changes: prefs.rideChanges,
    p_new_rides: prefs.newRides,
    p_approvals: prefs.approvals,
    p_rev_sound: prefs.revSound,
  });
  if (error) throw friendlyError(error);
}
