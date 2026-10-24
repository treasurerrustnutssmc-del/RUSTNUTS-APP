-- Move the "who is asking?" helpers out of the public API into a private schema.
-- Policies and actions still use them, but nobody can call them directly over the internet.

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_approved_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where id = auth.uid() and approval = 'approved');
$$;

create or replace function private.is_national()
returns boolean language sql stable security definer set search_path = public as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null
      and role in ('nec_chair', 'nec_secretary', 'nec_auditor', 'president')
  );
$$;

create or replace function private.is_board_of(target_chapter uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select private.is_approved_member() and (
    private.is_national() or exists (
      select 1 from public.positions
      where member_id = auth.uid() and ended_on is null and chapter_id = target_chapter
        and role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
    )
  );
$$;

create or replace function private.chapter_of(target_member uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select chapter_id from public.members where id = target_member;
$$;

create or replace function private.is_approved(target_member uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where id = target_member and approval = 'approved');
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- Re-point every policy at the private helpers.
alter policy chapters_manage on public.chapters to authenticated
  using (private.is_national()) with check (private.is_national());

alter policy members_read on public.members to authenticated using (
  id = (select auth.uid())
  or (approval = 'approved' and private.is_approved_member())
  or private.is_board_of(chapter_id)
);

alter policy private_read on public.member_private to authenticated using (
  member_id = (select auth.uid()) or private.is_board_of(private.chapter_of(member_id))
);

alter policy bikes_read on public.bikes to authenticated using (
  member_id = (select auth.uid())
  or (private.is_approved(member_id) and private.is_approved_member())
  or private.is_board_of(private.chapter_of(member_id))
);

alter policy regos_read on public.bike_registrations to authenticated using (
  exists (
    select 1 from public.bikes b
    where b.id = bike_id
      and (b.member_id = (select auth.uid()) or private.is_board_of(private.chapter_of(b.member_id)))
  )
);

alter policy emergency_read on public.emergency_contacts to authenticated using (
  member_id = (select auth.uid()) or private.is_board_of(private.chapter_of(member_id))
);

alter policy positions_read on public.positions to authenticated using (
  member_id = (select auth.uid()) or private.is_approved_member()
);
alter policy positions_insert on public.positions to authenticated with check (
  private.is_approved(member_id)
  and case when chapter_id is null then private.is_national() else private.is_board_of(chapter_id) end
);
alter policy positions_update on public.positions to authenticated
  using (case when chapter_id is null then private.is_national() else private.is_board_of(chapter_id) end)
  with check (case when chapter_id is null then private.is_national() else private.is_board_of(chapter_id) end);

-- Actions: same behaviour, now calling the private helpers.
create or replace function public.approve_member(p_member uuid, p_status public.member_status)
returns void language plpgsql security definer set search_path = public as $$
declare
  target members%rowtype;
begin
  select * into target from members where id = p_member for update;
  if not found then raise exception 'No such applicant'; end if;
  if not private.is_board_of(target.chapter_id) then
    raise exception 'Only the % board can approve this applicant', (select name from chapters where id = target.chapter_id);
  end if;
  if target.approval <> 'pending' then raise exception 'This person is not waiting for approval'; end if;

  update members set
    approval = 'approved',
    status = p_status,
    joined_on = coalesce(joined_on, current_date),
    fng_started_on = case when p_status = 'fng' then coalesce(fng_started_on, current_date) else fng_started_on end,
    patched_on = case when p_status in ('full', 'nomad') then coalesce(patched_on, current_date) else patched_on end,
    updated_at = now()
  where id = p_member;
end;
$$;

create or replace function public.decline_member(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  target members%rowtype;
begin
  select * into target from members where id = p_member for update;
  if not found then raise exception 'No such applicant'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Not your chapter'; end if;
  if target.approval <> 'pending' then raise exception 'This person is not waiting for approval'; end if;
  update members set approval = 'declined', updated_at = now() where id = p_member;
end;
$$;

create or replace function public.set_member_status(p_member uuid, p_status public.member_status)
returns void language plpgsql security definer set search_path = public as $$
declare
  target members%rowtype;
begin
  if p_member = auth.uid() then raise exception 'You can''t change your own status'; end if;
  select * into target from members where id = p_member for update;
  if not found then raise exception 'No such member'; end if;
  if not private.is_board_of(target.chapter_id) then raise exception 'Not your chapter'; end if;
  if target.approval <> 'approved' then raise exception 'Approve them first'; end if;

  update members set
    status = p_status,
    fng_started_on = case when p_status = 'fng' then coalesce(fng_started_on, current_date) else fng_started_on end,
    patched_on = case when p_status in ('full', 'nomad') then coalesce(patched_on, current_date) else patched_on end,
    updated_at = now()
  where id = p_member;
end;
$$;

create or replace function public.member_phone(p_member uuid)
returns text language sql stable security definer set search_path = public as $$
  select mp.phone
  from member_private mp join members m on m.id = mp.member_id
  where mp.member_id = p_member
    and (
      p_member = auth.uid()
      or private.is_board_of(m.chapter_id)
      or (m.share_phone and m.approval = 'approved' and private.is_approved_member())
    );
$$;

-- The old public helpers are no longer used; nobody can call them any more.
revoke execute on function public.is_board_of(uuid), public.is_national(), public.is_approved_member(),
  public.chapter_of(uuid), public.is_approved(uuid) from public, anon, authenticated;
