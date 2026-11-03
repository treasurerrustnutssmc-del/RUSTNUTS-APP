-- Checks the sign-up block list: a listed address (or a listed @domain) can't create a sign-in, so
-- Supabase sends it no code; everyone else, including new applicants, still can; app roles can't
-- read or change the list. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

\echo 'The crawler that keeps poking the sign-in page is on the list'
do $$
begin
  assert private.signup_blocked('crawlerrobo@gmail.com'), 'crawlerrobo is listed';
  assert private.signup_blocked('  CrawlerRobo@Gmail.com '), 'case and spaces do not get round it';
  assert not private.signup_blocked('rusty@gmail.com'), 'other gmail addresses are fine';
  assert not private.signup_blocked(null), 'no email (phone sign-in) is not blocked';
  assert private.signup_blocked('test@example.com'), 'the robot''s second address';
  assert not private.signup_blocked('rusty@example.com'), 'only that address, not the whole test domain';
  assert not private.signup_blocked('review@rustnutssmc.com.au'), 'the store reviewer login is not blocked';
end $$;

\echo 'A listed address cannot create a sign-in'
do $$
begin
  begin
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'crawlerrobo@gmail.com');
    raise exception 'the crawler got a sign-in';
  exception when insufficient_privilege then null;
  end;
  assert not exists (select 1 from auth.users where email = 'crawlerrobo@gmail.com'), 'no row left behind';
end $$;

\echo 'A listed domain blocks every address on it'
insert into private.blocked_signups (pattern, reason) values ('@spam.example', 'test domain');
do $$
begin
  begin
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e2', 'anyone@SPAM.example');
    raise exception 'a blocked domain got a sign-in';
  exception when insufficient_privilege then null;
  end;
  assert not private.signup_blocked('anyone@notspam.example'), 'a domain only matches whole';
end $$;

\echo 'New applicants and members still sign up as before'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e3', 'new.hangaround@gmail.com');
do $$
begin
  assert exists (select 1 from auth.users where email = 'new.hangaround@gmail.com'), 'a normal sign-up works';
  -- Changing an existing sign-in's email to a listed one is refused too.
  begin
    update auth.users set email = 'crawlerrobo@gmail.com' where id = '00000000-0000-0000-0000-0000000000e3';
    raise exception 'an email change slipped past the list';
  exception when insufficient_privilege then null;
  end;
end $$;

\echo 'No app role can read or change the list'
do $$
declare r text;
begin
  foreach r in array array['authenticated', 'anon'] loop
    execute format('set local role %I', r);
    begin
      perform 1 from private.blocked_signups;
      raise exception '% read the block list', r;
    exception when insufficient_privilege then null;
    end;
    begin
      perform private.signup_blocked('x@y.z');
      raise exception '% called the block check', r;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
end $$;

\echo 'Running the migration again removes an unconfirmed sign-in made before its address was listed, and keeps a confirmed one'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e4', 'robot2@gmail.com');
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000e5', 'real@listed.example', now());
insert into private.blocked_signups (pattern, reason) values ('robot2@gmail.com', 'test'), ('@listed.example', 'test');
\ir ../migrations/20270830000000_blocked_signups.sql
do $$
begin
  assert not exists (select 1 from auth.users where email = 'robot2@gmail.com'), 'the unconfirmed robot sign-in is gone';
  assert exists (select 1 from auth.users where email = 'real@listed.example'), 'a confirmed sign-in is left alone';
  assert exists (select 1 from auth.users where email = 'new.hangaround@gmail.com'), 'an unlisted sign-in is left alone';
  assert (select count(*) from private.blocked_signups where pattern = 'crawlerrobo@gmail.com') = 1, 'no duplicate entry';
end $$;

\echo 'A typo in a pattern is refused'
do $$
begin
  begin
    insert into private.blocked_signups (pattern, reason) values ('foo@', 'typo');
    raise exception 'a junk pattern was accepted';
  exception when check_violation then null;
  end;
end $$;

\o
\echo 'Blocked sign-up checks passed'
