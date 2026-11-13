-- No passwords. Members sign in with emailed codes and the app has no password screen, but Supabase
-- Auth's email provider also takes password sign-ups and "set password" calls with the public key.
-- Someone could set a password on a member's address before the member claims it, then sign in as
-- them once the member's first code confirms the address. The Password Verification Attempt hook the
-- claimable-roster spec asked for is only sold on Supabase's Teams and Enterprise plans, so instead
-- the sign-in table itself keeps no passwords: whatever Auth tries to store is dropped on the way in.
-- With nothing stored, a password sign-in always fails ("Invalid login credentials"). Email codes
-- never read this column, so members notice nothing.
--
-- This only works together with "Confirm email" ON (Authentication > Sign In / Providers > Email).
-- With it off, Supabase hands a password sign-up a live session straight away, before any password
-- check, and this trigger can't take that back. With it on, a password sign-up gets no session and
-- confirming the address needs the member's own inbox.

create or replace function private.drop_password()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.encrypted_password := null;
  return new;
end $$;
revoke all on function private.drop_password() from public, anon, authenticated, service_role;

drop trigger if exists no_passwords on auth.users;
create trigger no_passwords before insert or update of encrypted_password on auth.users
  for each row execute function private.drop_password();

-- Supabase gives email-code accounts a random password as well; clear the ones stored so far.
-- Safe to run twice.
update auth.users set encrypted_password = null where encrypted_password is not null;
