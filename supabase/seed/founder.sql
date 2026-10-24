-- Makes the founder the first approved member, since nobody exists yet to approve him.
-- Run after he has signed in to the app for the first time (so his auth user exists). Safe to run again.
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
),
wanted as (
  select m.id as member_id, null::uuid as chapter_id, r.role::public.position_role as role
  from member m, (values ('founder'), ('nec_chair')) as r(role)
  union all
  select m.id, c.id, 'treasurer' from member m, public.chapters c where c.slug in ('west', 'north')
)
-- Safe to run again: skips any seat he already holds.
insert into public.positions (member_id, chapter_id, role)
select w.member_id, w.chapter_id, w.role from wanted w
where not exists (
  select 1 from public.positions p
  where p.member_id = w.member_id and p.role = w.role
    and p.chapter_id is not distinct from w.chapter_id and p.ended_on is null
);
