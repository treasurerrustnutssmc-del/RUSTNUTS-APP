-- Untagged calendar rides are non-club events (Jeff, 3 Nov 2026).
-- Every club ride on the "Rustnuts Rides" Google calendar carries a "Label: Rustnuts" line, and the
-- six without one (Silverbacks Coward Punch Ride, Redback Rally, Brighter Days Festival, Black Dog
-- Ride, International Female Ride Day, Finke Desert Race) are other people's events. The club can't
-- edit that calendar, so the feed stops colouring everything 'club': each ride's colour now comes
-- from its label, then a "West:" title prefix, and otherwise it is a Non-Nuts event (categoryFor in
-- supabase/functions/_shared/ics.ts). The next sync (every 15 minutes) recolours the rides.
-- Safe to run twice.
update private.ride_feeds
set category = null
where category = 'club'
  and url = 'https://calendar.google.com/calendar/ical/rsmc.ridecommitee%40gmail.com/public/basic.ics';
