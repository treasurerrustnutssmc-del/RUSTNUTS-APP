// The live database's rides made in the app: each action's arguments, cleaned the way the database
// cleans them, so the app's own check (newRide.ts) sees what the database will see.

import { cleanRideInput, type RideInput } from '../domain/newRide';

export const saveRideArgs = (raw: RideInput, id: string | null) => {
  const input = cleanRideInput(raw);
  return {
    p_id: id, p_title: input.title, p_starts_at: input.startsAt, p_ends_at: input.endsAt, p_all_day: input.allDay,
    p_category: input.category, p_location: input.location, p_notes: input.notes === '' ? null : input.notes, p_website: input.website,
  };
};

export const setRideCalledOffArgs = (id: string, off: boolean) => ({ p_id: id, p_off: off });
