-- Club news for the public website (website-and-app task 21). A board member writes a short
-- notice on the Board screen; the club website's home page shows the newest five that are less
-- than 60 days old, through the site-api Edge Function as anon. The same rules and words as
-- src/domain/siteNews.ts. Spec: docs/superpowers/specs/2026-11-01-website-news-design.md

create table public.site_news (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 80),
  body text not null check (length(body) between 1 and 400),
  link text check (link ~ '^https://\S+$' and length(link) <= 300),
  posted_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.members(id) on delete set null,
  check ((removed_at is null) = (removed_by is null))
);
create index site_news_created_idx on public.site_news (created_at desc);
create index site_news_posted_by_idx on public.site_news (posted_by);
create index site_news_removed_by_idx on public.site_news (removed_by);

-- The select policy below runs as the reader, so they need to be able to ask whether they're board.
-- (It only answers about the caller; nothing about anyone else.)
grant execute on function private.is_any_board() to authenticated;

alter table public.site_news enable row level security;
revoke all on public.site_news from public, anon, authenticated;
grant select on public.site_news to authenticated;
create policy site_news_for_board on public.site_news for select to authenticated
  using (private.is_any_board());

-- Posts a notice. Refusals in the app's order and words.
create or replace function public.post_site_news(p_title text, p_body text, p_link text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_link text := nullif(trim(coalesce(p_link, '')), '');
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can post club news.'; end if;
  if v_title = '' then raise exception 'Give the notice a title.'; end if;
  if length(v_title) > 80 then raise exception 'Keep the title to 80 characters.'; end if;
  if v_body = '' then raise exception 'Write what members of the public should know.'; end if;
  if length(v_body) > 400 then raise exception 'Keep the notice to 400 characters.'; end if;
  if v_link is not null and (length(v_link) > 300 or v_link !~ '^https://\S+$') then
    raise exception 'The link must start with https://.';
  end if;
  insert into public.site_news (title, body, link, posted_by)
  values (v_title, v_body, v_link, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.post_site_news(text, text, text) from public, anon;
grant execute on function public.post_site_news(text, text, text) to authenticated;

-- Takes a notice off the website. Any board seat may take any notice down.
create or replace function public.remove_site_news(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  n public.site_news%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can post club news.'; end if;
  select * into n from public.site_news where id = p_id for update;
  if not found then raise exception 'No such notice.'; end if;
  if n.removed_at is not null then raise exception 'That notice has already been taken down.'; end if;
  update public.site_news set removed_at = now(), removed_by = auth.uid() where id = p_id;
end;
$$;
revoke all on function public.remove_site_news(uuid) from public, anon;
grant execute on function public.remove_site_news(uuid) to authenticated;

-- The board's list: live notices newest first, then the ones taken down.
create or replace function public.list_site_news()
returns setof public.site_news
language sql stable security invoker set search_path = '' as $$
  select * from public.site_news
  order by (removed_at is not null), created_at desc, id;
$$;
revoke all on function public.list_site_news() from public, anon;
grant execute on function public.list_site_news() to authenticated;

-- The website's feed: the newest five live notices under 60 days old. Nothing personal: no
-- posted_by, no removed_by. Mirrors publicNews in src/domain/siteNews.ts.
create or replace function public.public_site_news()
returns table (id uuid, title text, body text, link text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select n.id, n.title, n.body, n.link, n.created_at
  from public.site_news n
  where n.removed_at is null and n.created_at > now() - interval '60 days'
  order by n.created_at desc, n.id
  limit 5;
$$;
revoke all on function public.public_site_news() from public;
grant execute on function public.public_site_news() to anon, authenticated;
