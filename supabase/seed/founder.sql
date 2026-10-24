-- Makes the founder the first approved member, since nobody exists yet to approve him.
-- Run once, after he has signed in to the app for the first time (so his auth user exists).
-- Everyone after this goes through Ask to join and the Board tab.

with founder as (
  select id from auth.users where email = 'treasurer.rustnutssmc@gmail.com'
),
member as (
  insert into public.members (id, chapter_id, full_name, road_name, status, approval, joined_on, patched_on)
  select f.id, c.id, 'Jeff Ostler', 'El Jefe', 'full', 'approved', date '2019-01-01', date '2019-01-01'
  from founder f, public.chapters c
  where c.slug = 'west'
  on conflict (id) do update set approval = 'approved', status = 'full'
  returning id
)
insert into public.positions (member_id, chapter_id, role)
select m.id, null, r.role::public.position_role from member m, (values ('founder'), ('nec_chair')) as r(role)
union all
select m.id, c.id, 'treasurer' from member m, public.chapters c where c.slug in ('west', 'north');
