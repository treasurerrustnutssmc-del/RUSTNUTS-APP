-- Website visitor counts (website-and-app task 30). Each club website page pings the site-api
-- function, which calls site_visit() with the service role; the database keeps one count per
-- Melbourne day per page. No IP, no agent, no referrer, no cookie: nothing about the person.
-- The board reads the last 30 days with site_visit_summary(). Mirrors src/domain/siteVisits.ts.
-- Spec: docs/superpowers/specs/2026-11-01-website-visits-design.md

create table public.site_visits (
  day date not null,
  page text not null check (page ~ '^/[a-z0-9/._-]*$' and length(page) <= 80),
  hits integer not null default 0 check (hits >= 0),
  primary key (day, page)
);
alter table public.site_visits enable row level security;
revoke all on public.site_visits from public, anon, authenticated;

-- Counts one view. A page that isn't a site path is dropped without a word (the website never
-- sees an error), and a day stops taking new pages at 200 so a flood of made-up paths can't grow
-- the table. "/index.html" and "" count as "/".
create or replace function public.site_visit(p_page text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_page text := trim(coalesce(p_page, ''));
  v_day date := (now() at time zone 'Australia/Melbourne')::date;
begin
  if v_page = '' or v_page = '/index.html' then v_page := '/'; end if;
  if left(v_page, 1) <> '/' then v_page := '/' || v_page; end if;
  if length(v_page) > 80 or v_page !~ '^/[a-z0-9/._-]*$' then return; end if;
  if not exists (select 1 from public.site_visits v where v.day = v_day and v.page = v_page)
     and (select count(*) from public.site_visits v where v.day = v_day) >= 200 then
    return;
  end if;
  insert into public.site_visits (day, page, hits) values (v_day, v_page, 1)
  on conflict (day, page) do update set hits = public.site_visits.hits + 1;
end;
$$;
revoke all on function public.site_visit(text) from public, anon, authenticated;
grant execute on function public.site_visit(text) to service_role;

-- The board's summary: the last 30 days, newest day first, busiest page first within a day.
create or replace function public.site_visit_summary()
returns table (day date, page text, hits integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not private.is_approved_member() then raise exception 'Only approved members can do that.'; end if;
  if not private.is_any_board() then raise exception 'Only the board can see website visits.'; end if;
  return query
    select v.day, v.page, v.hits from public.site_visits v
    where v.day >= (now() at time zone 'Australia/Melbourne')::date - 29
    order by v.day desc, v.hits desc, v.page;
end;
$$;
revoke all on function public.site_visit_summary() from public, anon;
grant execute on function public.site_visit_summary() to authenticated;
