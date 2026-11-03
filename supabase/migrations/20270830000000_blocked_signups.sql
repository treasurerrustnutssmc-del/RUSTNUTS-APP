-- Sign-up block list. Google's test robot ("crawlerrobo@gmail.com", from Google's own servers)
-- keeps typing its address into the sign-in screen, which made an unconfirmed sign-in on 1 Nov and
-- again on 3 Nov 2026 and had Supabase email it codes. A listed address, or every address on a
-- listed @domain, now can't create a sign-in at all, so no account row is made and no code is sent.
-- Everyone else, including new people applying to join, signs up exactly as before.
-- Add one later with: insert into private.blocked_signups (pattern, reason) values ('x@y.com', 'why');

create table if not exists private.blocked_signups (
  pattern text primary key check (pattern = lower(btrim(pattern)) and pattern ~ '^([^@[:space:]]+)?@[^@[:space:]]+\.[^@[:space:]]+$'),
  reason text not null,
  added_on date not null default (now() at time zone 'Australia/Melbourne')::date
);
alter table private.blocked_signups enable row level security;
revoke all on private.blocked_signups from public, anon, authenticated, service_role;

insert into private.blocked_signups (pattern, reason) values
  ('crawlerrobo@gmail.com', 'Google test robot; made unconfirmed sign-ins 1 and 3 Nov 2026')
on conflict (pattern) do nothing;

-- A whole address, or "@domain" for everyone on exactly that domain (not its subdomains).
-- Keep this function closed to app roles: if a later migration grants execute on all of private
-- to authenticated, revoke it here again, or members could test whether an address is listed.
create or replace function private.signup_blocked(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.blocked_signups b, lower(btrim(p_email)) as e
    where b.pattern = e or (left(b.pattern, 1) = '@' and right(e, length(b.pattern)) = b.pattern)
  )
$$;
revoke all on function private.signup_blocked(text) from public, anon, authenticated, service_role;

create or replace function private.refuse_blocked_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.signup_blocked(new.email) then
    raise exception 'Sign-ups from this address are not accepted.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke all on function private.refuse_blocked_signup() from public, anon, authenticated, service_role;

drop trigger if exists refuse_blocked_signup on auth.users;
create trigger refuse_blocked_signup before insert or update of email on auth.users
  for each row execute function private.refuse_blocked_signup();

-- A listed address that already has a sign-in would get codes as before (signing in again only
-- touches the token columns), so remove any such sign-in that was never confirmed. A confirmed
-- one is left for a person to look at. Deleting goes through forget_deleted_member, harmless here.
delete from auth.users u where u.email_confirmed_at is null and private.signup_blocked(u.email);
