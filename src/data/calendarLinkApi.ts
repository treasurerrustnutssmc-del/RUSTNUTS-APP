// The signed-in member's private ride calendar link (live mode): public.my_calendar_link, or
// public.new_calendar_link to replace it. Spec: docs/superpowers/specs/2026-11-28-personal-ride-calendar-design.md.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { friendlyError } from './friendlyError';

export async function loadCalendarToken(db: SupabaseClient<Database>, fresh: boolean): Promise<string> {
  const { data, error } = await db.rpc(fresh ? 'new_calendar_link' : 'my_calendar_link');
  if (error?.code === 'PGRST202') throw new Error('Rides in your calendar isn’t switched on yet. Check back soon.');
  if (error) throw friendlyError(error);
  if (typeof data !== 'string' || !/^[0-9a-f]{64}$/.test(data)) throw new Error('The app couldn’t make your link. Try again.');
  return data;
}
