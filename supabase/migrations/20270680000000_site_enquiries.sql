-- Join enquiries from the club website's "Ride With Us" form. The site-api Edge Function checks the
-- form and calls site_enquiry() with the service role; the chapter board reads them on the Board
-- screen and marks them handled. The same rules and words as src/domain/enquiries.ts.
-- Spec: docs/superpowers/specs/2026-11-01-website-sponsors-and-enquiries-design.md

create table public.site_enquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  email text not null check (length(email) <= 200),
  chapter_slug text not null check (chapter_slug in ('west', 'north', 'either')),
  about text check (length(about) <= 600),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.members(id) on delete set null,
  note text check (length(note) <= 300),
  check ((handled_at is null) = (handled_by is null))
);
create index site_enquiries_handled_by_idx on public.site_enquiries (handled_by);
create index site_enquiries_email_created_idx on public.site_enquiries (email, created_at);
create index site_enquiries_created_idx on public.site_enquiries (created_at);

-- Who sees an enquiry: a board seat in the chapter it names, any board seat for "either", and the
-- NEC officers (Chairman, Secretary) for the lot. The same as enquiriesSeenBy in the app.
create or replace function private.sees_site_enquiry(target_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and (
    private.is_nec_officer() or exists (
      select 1 from public.positions p
      join public.chapters c on c.id = p.chapter_id
      where p.member_id = auth.uid() and p.ended_on is null
        and p.role in ('president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain')
        and (target_slug = 'either' or c.slug = target_slug)
    )
  );
$$;
revoke all on function private.sees_site_enquiry(text) from public, anon;
grant execute on function private.sees_site_enquiry(text) to authenticated;

alter table public.site_enquiries enable row level security;
revoke all on public.site_enquiries from public, anon, authenticated;
grant select on public.site_enquiries to authenticated;
create policy site_enquiries_for_board on public.site_enquiries for select to authenticated
  using (private.sees_site_enquiry(chapter_slug));

-- The website's door, called by the site-api function with the service role after its own checks.
-- The same checks again here, in the same words, then the spam limits: the same address at most
-- three a day, and at most thirty an hour from everyone. Nothing else is kept (no IP, no agent).
create or replace function public.site_enquiry(p_name text, p_email text, p_chapter text, p_about text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_about text := nullif(trim(coalesce(p_about, '')), '');
  new_id uuid;
begin
  if v_name = '' then raise exception 'Tell us your name.'; end if;
  if length(v_name) > 80 then raise exception 'Keep your name to 80 characters.'; end if;
  if length(v_email) > 200 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'That email address does not look right.';
  end if;
  if p_chapter is null or p_chapter not in ('west', 'north', 'either') then
    raise exception 'Pick a chapter: West, North or either.';
  end if;
  if length(v_about) > 600 then raise exception 'Keep it to 600 characters.'; end if;

  -- One at a time, so two enquiries landing together can't both squeeze under a limit.
  perform pg_advisory_xact_lock(hashtext('site_enquiry'));
  if (select count(*) from public.site_enquiries e
      where e.email = v_email and e.created_at > now() - interval '1 day') >= 3
     or (select count(*) from public.site_enquiries e where e.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many enquiries just now. Try again later, or email the club.';
  end if;

  insert into public.site_enquiries (name, email, chapter_slug, about)
  values (v_name, v_email, p_chapter, v_about)
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.site_enquiry(text, text, text, text) from public, anon, authenticated;
grant execute on function public.site_enquiry(text, text, text, text) to service_role;

-- The board's list: what they may see, open ones first (newest first), then handled ones.
create or replace function public.list_site_enquiries()
returns setof public.site_enquiries
language sql stable security invoker set search_path = '' as $$
  select * from public.site_enquiries
  order by (handled_at is not null), created_at desc, id;
$$;
revoke all on function public.list_site_enquiries() from public, anon;
grant execute on function public.list_site_enquiries() to authenticated;

-- Marks an enquiry handled by the caller, with an optional note. Refusals in the app's order.
-- (The National Auditor counts as board here but not in the app, so they get "No such enquiry.")
create or replace function public.handle_site_enquiry(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.site_enquiries%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can see website enquiries.'; end if;
  select * into e from public.site_enquiries where id = p_id for update;
  if not found or not private.sees_site_enquiry(e.chapter_slug) then raise exception 'No such enquiry.'; end if;
  if e.handled_at is not null then raise exception 'That enquiry has already been handled.'; end if;
  if length(v_note) > 300 then raise exception 'Keep the note to 300 characters.'; end if;
  update public.site_enquiries
  set handled_at = now(), handled_by = auth.uid(), note = v_note
  where id = p_id;
end;
$$;
revoke all on function public.handle_site_enquiry(uuid, text) from public, anon;
grant execute on function public.handle_site_enquiry(uuid, text) to authenticated;
