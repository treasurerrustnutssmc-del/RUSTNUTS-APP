-- The club website's public ride list, read through the site-api Edge Function as anon.
-- Only what is already public: the rides that came from the club's public Google calendars
-- (source = 'feed'), with their title, when, category, location, notes and cancellation. A ride
-- made in the app (source = 'app') is not listed at all until the club decides what of it is
-- public; its title, place and notes stay with members. No RSVPs, no crew, no member data.
-- Window: a year back to two years ahead, the same the website asks its calendar for.
-- Granted to anon (the website) and authenticated alike; it holds nothing a signed-out visitor
-- can't already read on the calendars.

create or replace function public.public_rides()
returns table (id uuid, title text, starts_at timestamptz, ends_at timestamptz, all_day boolean,
               category public.ride_category, location text, notes text, cancelled_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, r.starts_at, r.ends_at, r.all_day, r.category, r.location, r.notes,
         r.cancelled_at
  from public.rides r
  where r.source = 'feed'
    and r.starts_at >= now() - interval '1 year'
    and r.starts_at <  now() + interval '2 years'
  order by r.starts_at, r.id;
$$;
revoke all on function public.public_rides() from public;
grant execute on function public.public_rides() to anon, authenticated;
