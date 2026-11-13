-- Checks that the sign-in table keeps no passwords: a sign-up made with a password stores none, a
-- password set on an existing account later is dropped, the migration clears any stored before it
-- ran, other columns still update, and app roles can't touch the function. Run with: npm run test:db
--
-- Supabase Auth refuses a password sign-in when the account has no stored password ("Invalid login
-- credentials"), which is what the app's email-code sign-in relies on. That half is checked live.

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

\echo 'A sign-up made with a password stores none'
insert into auth.users (id, email, encrypted_password)
  values ('00000000-0000-0000-0000-0000000000f1', 'with.password@gmail.com', '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
do $$
begin
  assert (select encrypted_password from auth.users where id = '00000000-0000-0000-0000-0000000000f1') is null, 'the password was stored';
  assert exists (select 1 from auth.users where email = 'with.password@gmail.com'), 'the sign-up itself still went through';
end $$;

\echo 'A password set on an existing account later is dropped, and other changes still land'
update auth.users set encrypted_password = '$2a$10$zyxwvutsrqponmlkjihgfeZYXWVUTSRQPONMLKJIHGFEDCBA987654', email_confirmed_at = now()
  where id = '00000000-0000-0000-0000-0000000000f1';
do $$
declare u auth.users;
begin
  select * into u from auth.users where id = '00000000-0000-0000-0000-0000000000f1';
  assert u.encrypted_password is null, 'the later password was kept';
  assert u.email_confirmed_at is not null, 'confirming the email still works';
end $$;

\echo 'Running the migration clears passwords stored before it existed'
alter table auth.users disable trigger no_passwords;
insert into auth.users (id, email, encrypted_password)
  values ('00000000-0000-0000-0000-0000000000f2', 'old.random@gmail.com', '$2a$10$oldrandomhasholdrandomhasholdrandomhasholdrandomhash00');
alter table auth.users enable trigger no_passwords;
do $$
begin
  assert (select encrypted_password from auth.users where id = '00000000-0000-0000-0000-0000000000f2') is not null, 'test setup: a stored hash';
end $$;
\ir ../migrations/20270840000000_no_passwords.sql
do $$
begin
  assert (select count(*) from auth.users where encrypted_password is not null) = 0, 'a stored password survived the migration';
  assert exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000f2'), 'the account itself is kept';
end $$;

\echo 'No app role can call the function'
do $$
declare r text;
begin
  foreach r in array array['authenticated', 'anon', 'service_role'] loop
    execute format('set local role %I', r);
    begin
      perform private.drop_password();
      raise exception '% called the password drop', r;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
end $$;

\o
\echo 'No-password checks passed'
