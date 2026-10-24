-- Stage 3 (lane B): link previews in chats. The link-preview Edge Function reads a page's Open
-- Graph tags and keeps what it found here for 7 days, so each link is fetched once a week at most.
-- Pages that had nothing to show are kept too (preview null), so they aren't tried again and again.

create table private.link_previews (
  url text primary key,
  preview jsonb,
  fetched_at timestamptz not null default now()
);
alter table private.link_previews enable row level security;

-- What's kept for a link, for an approved member: {"found": false} when it needs fetching,
-- otherwise {"found": true, "preview": ...} (preview null when the page had nothing to show).
create or replace function public.link_preview(p_url text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  kept private.link_previews%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  select * into kept from private.link_previews where url = p_url and fetched_at > now() - interval '7 days';
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'preview', kept.preview);
end;
$$;

-- Keeps what the Edge Function found. Only the Edge Function (service key) can call it.
create or replace function public.save_link_preview(p_url text, p_preview jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into private.link_previews (url, preview, fetched_at) values (left(p_url, 2000), p_preview, now())
  on conflict (url) do update set preview = excluded.preview, fetched_at = excluded.fetched_at;
$$;

revoke all on function public.link_preview(text), public.save_link_preview(text, jsonb) from public, anon, authenticated;
grant execute on function public.link_preview(text) to authenticated;
grant execute on function public.save_link_preview(text, jsonb) to service_role;
