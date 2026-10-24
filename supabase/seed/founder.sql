-- Makes the founder the first approved member, since nobody exists yet to approve him.
-- Run after he has signed in to the app for the first time (so his auth user exists).
-- Safe to run again: it only hands out a seat that is empty and that he has never held,
-- so it won't undo a hand-over. Everyone after this goes through Ask to join and the Board tab.

do $$
begin
  if not exists (select 1 from auth.users where email = 'treasurer.rustnutssmc@gmail.com') then
    raise exception 'El Jefe hasn''t signed in to the app yet. Sign in once, then run this again.';
  end if;
end $$;

with founder as (
  select id from auth.users where email = 'treasurer.rustnutssmc@gmail.com'
),
member as (
  insert into public.members (id, chapter_id, full_name, road_name, status, approval, joined_on, patched_on)
  select f.id, c.id, 'Jeff Ostler', 'El Jefe', 'full', 'approved', date '2019-01-01', date '2019-01-01'
  from founder f, public.chapters c
  where c.slug = 'west'
  on conflict (id) do update set
    chapter_id = excluded.chapter_id,
    full_name = excluded.full_name,
    road_name = coalesce(public.members.road_name, excluded.road_name),
    status = 'full',
    approval = 'approved',
    joined_on = coalesce(public.members.joined_on, excluded.joined_on),
    patched_on = coalesce(public.members.patched_on, excluded.patched_on)
  returning id
),
wanted as (
  select m.id as member_id, null::uuid as chapter_id, r.role::public.position_role as role
  from member m, (values ('founder'), ('nec_chair')) as r(role)
  union all
  select m.id, c.id, 'treasurer' from member m, public.chapters c where c.slug in ('west', 'north')
)
insert into public.positions (member_id, chapter_id, role)
select w.member_id, w.chapter_id, w.role from wanted w
where not exists ( -- he has held it before, so it was handed on on purpose
  select 1 from public.positions p
  where p.member_id = w.member_id and p.role = w.role and p.chapter_id is not distinct from w.chapter_id
)
and not exists ( -- someone else holds it now
  select 1 from public.positions p
  where p.role = w.role and p.chapter_id is not distinct from w.chapter_id and p.ended_on is null
);

-- His contact and licence record, which the profile screen saves into.
insert into public.member_private (member_id, email)
select m.id, u.email
from auth.users u join public.members m on m.id = u.id
where u.email = 'treasurer.rustnutssmc@gmail.com'
on conflict (member_id) do nothing;
