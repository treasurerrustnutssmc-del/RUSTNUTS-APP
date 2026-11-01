-- Feedback & issues: members tell the club what's wrong with the app, or what they'd like. Anyone
-- approved in the app (Family too) sends a report with an optional screenshot and what the app
-- attached (version, build, phone). The app keepers (a sitting Treasurer, or the NEC Chairman or
-- Secretary) read them all on the Board screen, set a status, reply, and the sender hears by push.
-- The same rules and words as src/domain/feedback.ts.
-- Spec: docs/superpowers/specs/2026-11-01-app-feedback-design.md

create table public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  kind text not null check (kind in ('bug', 'idea', 'other')),
  body text not null check (length(body) between 1 and 1000),
  where_in_app text check (length(where_in_app) <= 60),
  screenshot_path text,
  app_version text not null default '' check (length(app_version) <= 40),
  build text not null default '' check (length(build) <= 80),
  device text not null default '' check (length(device) <= 120),
  status text not null default 'new' check (status in ('new', 'looking', 'done')),
  reply text check (length(reply) <= 600),
  replied_by uuid references public.members(id) on delete set null,
  replied_at timestamptz,
  reply_count int not null default 0,
  status_changed_at timestamptz,
  created_at timestamptz not null default now()
);
create index app_feedback_member_created_idx on public.app_feedback (member_id, created_at);
create index app_feedback_replied_by_idx on public.app_feedback (replied_by);
create index app_feedback_created_idx on public.app_feedback (created_at);

-- Anyone approved in the app, Family included: whoever uses it can report on it.
create or replace function private.uses_app()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where id = auth.uid() and approval = 'approved');
$$;
revoke all on function private.uses_app() from public, anon;
grant execute on function private.uses_app() to authenticated;

-- A sitting Treasurer (either chapter) or NEC Chairman / Secretary. The same as isFeedbackKeeper.
create or replace function private.is_feedback_keeper()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() and exists (
    select 1 from public.positions
    where member_id = auth.uid() and ended_on is null
      and role in ('treasurer', 'nec_chair', 'nec_secretary')
  );
$$;
revoke all on function private.is_feedback_keeper() from public, anon;
grant execute on function private.is_feedback_keeper() to authenticated;

alter table public.app_feedback enable row level security;
revoke all on public.app_feedback from public, anon, authenticated;
grant select on public.app_feedback to authenticated;
create policy app_feedback_own_or_keeper on public.app_feedback for select to authenticated
  using (member_id = (select auth.uid()) or private.is_feedback_keeper());

-- Screenshots: a private bucket. Senders upload into their own folder (`<member id>/...`); they and
-- the keepers read them; a stray upload that never went on a report can be tidied by its owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-media', 'feedback-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function private.feedback_file_in_use(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_feedback where screenshot_path = p_name);
$$;
revoke all on function private.feedback_file_in_use(text) from public, anon;
grant execute on function private.feedback_file_in_use(text) to authenticated;

create policy feedback_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'feedback-media' and split_part(name, '/', 1) = auth.uid()::text and private.uses_app());
create policy feedback_media_read on storage.objects for select to authenticated
  using (bucket_id = 'feedback-media' and (split_part(name, '/', 1) = auth.uid()::text or private.is_feedback_keeper()));
create policy feedback_media_tidy on storage.objects for delete to authenticated
  using (bucket_id = 'feedback-media' and owner_id = auth.uid()::text and not private.feedback_file_in_use(name));

-- Sends a report. Refusals in the app's order and words. The tech strings are trimmed and cut to
-- size, never refused: they're the app's own, and a long one is still worth keeping.
create or replace function public.send_app_feedback(
  p_kind text, p_body text, p_where text, p_screenshot_path text, p_app_version text, p_build text, p_device text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_body text := trim(coalesce(p_body, ''));
  v_where text := nullif(trim(coalesce(p_where, '')), '');
  v_shot text := nullif(trim(coalesce(p_screenshot_path, '')), '');
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.uses_app() then raise exception 'Only approved members can do that.'; end if;
  if p_kind is null or p_kind not in ('bug', 'idea', 'other') then
    raise exception 'Pick what it is: something wrong, an idea or other.';
  end if;
  if v_body = '' then raise exception 'Tell us what happened.'; end if;
  if length(v_body) > 1000 then raise exception 'Keep it to 1,000 characters.'; end if;
  if length(v_where) > 60 then raise exception 'Keep “where” to 60 characters.'; end if;
  if v_shot is not null and (split_part(v_shot, '/', 1) <> auth.uid()::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'feedback-media' and o.name = v_shot)) then
    raise exception 'That screenshot didn’t upload. Try again.';
  end if;
  -- One at a time, so two sent together can't both squeeze under the limit.
  perform pg_advisory_xact_lock(hashtext('app_feedback:' || auth.uid()::text));
  if (select count(*) from public.app_feedback f where f.member_id = auth.uid() and f.created_at > now() - interval '1 day') >= 5 then
    raise exception 'That’s five today. Send more tomorrow, or message the treasurer.';
  end if;

  insert into public.app_feedback (member_id, kind, body, where_in_app, screenshot_path, app_version, build, device)
  values (auth.uid(), p_kind, v_body, v_where, v_shot,
          left(trim(coalesce(p_app_version, '')), 40), left(trim(coalesce(p_build, '')), 80), left(trim(coalesce(p_device, '')), 120))
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.send_app_feedback(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.send_app_feedback(text, text, text, text, text, text, text) to authenticated;

-- What the caller may see, with the sender's name, and their email for keepers only. Board order:
-- new, then looking, then done, newest first within each.
create or replace function public.list_app_feedback()
returns table (id uuid, member_id uuid, member_name text, member_email text, kind text, body text, where_in_app text,
               screenshot_path text, app_version text, build text, device text, status text, reply text,
               replied_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.id, f.member_id, m.full_name, case when private.is_feedback_keeper() then mp.email end,
         f.kind, f.body, f.where_in_app, f.screenshot_path, f.app_version, f.build, f.device, f.status, f.reply,
         f.replied_at, f.created_at
  from public.app_feedback f
  join public.members m on m.id = f.member_id
  left join public.member_private mp on mp.member_id = f.member_id
  where f.member_id = auth.uid() or private.is_feedback_keeper()
  order by case f.status when 'new' then 0 when 'looking' then 1 else 2 end, f.created_at desc, f.id;
$$;
revoke all on function public.list_app_feedback() from public, anon;
grant execute on function public.list_app_feedback() to authenticated;

-- A keeper sets the status and, with words, replaces the reply. An empty reply keeps the old one.
create or replace function public.answer_app_feedback(p_id uuid, p_status text, p_reply text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  f public.app_feedback%rowtype;
  v_reply text := nullif(trim(coalesce(p_reply, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.uses_app() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_feedback_keeper() then raise exception 'Only the app keepers can answer feedback.'; end if;
  select * into f from public.app_feedback where id = p_id for update;
  if not found then raise exception 'No such report.'; end if;
  if p_status is null or p_status not in ('new', 'looking', 'done') then
    raise exception 'Pick a status: new, looking into it or done.';
  end if;
  if length(v_reply) > 600 then raise exception 'Keep the reply to 600 characters.'; end if;
  update public.app_feedback
  set status = p_status,
      status_changed_at = case when p_status <> f.status then now() else status_changed_at end,
      reply = coalesce(v_reply, reply),
      replied_by = case when v_reply is not null then auth.uid() else replied_by end,
      replied_at = case when v_reply is not null then now() else replied_at end,
      reply_count = reply_count + (v_reply is not null)::int
  where id = p_id;
end;
$$;
revoke all on function public.answer_app_feedback(uuid, text, text) from public, anon;
grant execute on function public.answer_app_feedback(uuid, text, text) to authenticated;

-- A new report: every keeper hears, like a join request (their "approvals" setting), once per report.
create or replace function private.push_feedback_sent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who text := (select private.short_name(m) from public.members m where m.id = new.member_id);
begin
  insert into private.push_outbox (member_id, dedupe_key, title, body, data)
  select distinct pos.member_id, 'feedback:' || new.id, 'App feedback',
    who || ': ' || left(new.body, 80), jsonb_build_object('kind', 'feedback-sent', 'feedbackId', new.id)
  from public.positions pos
  join public.members k on k.id = pos.member_id
  left join public.notification_prefs p on p.member_id = pos.member_id
  where pos.ended_on is null and pos.role in ('treasurer', 'nec_chair', 'nec_secretary')
    and k.approval = 'approved' and k.status <> 'family' and pos.member_id <> new.member_id
    and coalesce(p.approvals, true)
  on conflict (member_id, dedupe_key) do nothing;
  return new;
end;
$$;
revoke all on function private.push_feedback_sent() from public, anon, authenticated;
create trigger app_feedback_push_sent after insert on public.app_feedback
  for each row execute function private.push_feedback_sent();

-- An answer: the sender hears each reply (once per reply), and "done" once. Their own report, so
-- it goes whatever their settings.
create or replace function private.push_feedback_answered()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reply_count > old.reply_count and new.reply is not null then
    insert into private.push_outbox (member_id, dedupe_key, title, body, data)
    values (new.member_id, 'feedback-reply:' || new.id || ':' || new.reply_count, 'Reply to your feedback',
            left(new.reply, 80), jsonb_build_object('kind', 'feedback', 'feedbackId', new.id))
    on conflict (member_id, dedupe_key) do nothing;
  elsif new.status = 'done' and old.status <> 'done' then
    insert into private.push_outbox (member_id, dedupe_key, title, body, data)
    values (new.member_id, 'feedback-done:' || new.id, 'Your feedback is marked done',
            left(new.body, 80), jsonb_build_object('kind', 'feedback', 'feedbackId', new.id))
    on conflict (member_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.push_feedback_answered() from public, anon, authenticated;
create trigger app_feedback_push_answered after update on public.app_feedback
  for each row execute function private.push_feedback_answered();

-- Delete my account: their reports go, and every file in their feedback folder (on a report or a
-- stray upload) joins the purge queue; the database can't delete files itself, the purge-files
-- function does. Runs when forget_member marks them.
create or replace function private.forget_feedback()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.account_deleted_on is not null and old.account_deleted_on is null then
    insert into private.storage_purge (bucket, path, member_id)
    select o.bucket_id, o.name, new.id from storage.objects o
    where o.bucket_id = 'feedback-media' and split_part(o.name, '/', 1) = new.id::text;
    delete from public.app_feedback where member_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.forget_feedback() from public, anon, authenticated;
create trigger members_forget_feedback after update of account_deleted_on on public.members
  for each row execute function private.forget_feedback();
