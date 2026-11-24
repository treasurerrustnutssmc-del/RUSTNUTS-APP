-- Checks Board files: who reads the rows and the bucket, who uploads into which folder, the
-- actions' refusals in the app's words (src/domain/boardFiles.ts), removing queues the file, and
-- tidying takes only unused paths. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- u1 National Chairman (West Full), u2 West Treasurer, u3 West Secretary, u4 West Full, u5 North
-- President, u6 past West Treasurer, u7 West Family, u8 pending applicant.
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-0000-0000-0000000000f' || n)::uuid, 'f' || n || '@example.com', now()
from generate_series(1, 8) n;

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, (select id from chapters where slug = v.ch), v.name, null, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000f1', 'west', 'Cal Chairman', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f2', 'west', 'Tess Treasurer', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f3', 'west', 'Sue Secretary', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f4', 'west', 'Fred Full', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f5', 'north', 'Pete President', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f6', 'west', 'Pat Past', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000f7', 'west', 'Fay Family', 'family', 'approved'),
  ('00000000-0000-0000-0000-0000000000f8', 'west', 'Al Applicant', 'introduced', 'pending')
) as v(id, ch, name, status, approval);

insert into positions (member_id, chapter_id, role, started_on, ended_on) values
  ('00000000-0000-0000-0000-0000000000f1', null, 'nec_chair', '2025-08-16', null),
  ('00000000-0000-0000-0000-0000000000f2', (select id from chapters where slug = 'west'), 'treasurer', '2025-08-16', null),
  ('00000000-0000-0000-0000-0000000000f3', (select id from chapters where slug = 'west'), 'secretary', '2025-08-16', null),
  ('00000000-0000-0000-0000-0000000000f5', (select id from chapters where slug = 'north'), 'president', '2025-08-16', null),
  ('00000000-0000-0000-0000-0000000000f6', (select id from chapters where slug = 'west'), 'treasurer', '2023-08-16', '2025-08-16');

create function pg_temp.try_as(who uuid, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  if who is null then set local role anon; else set local role authenticated; end if;
  begin
    execute stmt;
  exception when others then
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);
    return sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return null;
end $$;

create function pg_temp.value_as(who uuid, expr text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(who::text, ''), true);
  set local role authenticated;
  execute 'select (' || expr || ')::text' into v;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000f' || n)::uuid $$;
create function pg_temp.west() returns text language sql as $$ select id::text from chapters where slug = 'west' $$;
create function pg_temp.north() returns text language sql as $$ select id::text from chapters where slug = 'north' $$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.value_as(uuid, text), pg_temp.u(int), pg_temp.west(), pg_temp.north()
  to anon, authenticated;

\o

\echo 'Board files: the bucket, uploads, the actions and who reads them'
do $$
declare
  up text := $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('board-files', %L, auth.uid(), auth.uid()::text)$q$;
  add text := $q$public.add_board_file(%s, %L, %L, %L, %s)$q$;
  wt text := pg_temp.west() || '/treasurer/';
  nt text := pg_temp.north() || '/treasurer/';
  seat text := 'Only whoever holds this seat, or the National Chairman or Secretary, can change this folder.';
  readers text := 'Board files are for board members and the NEC.';
  info uuid;
  budget uuid;
begin
  assert (select count(*) from storage.buckets where id = 'board-files' and not public and file_size_limit = 20971520
    and 'application/pdf' = any(allowed_mime_types) and 'image/jpeg' = any(allowed_mime_types)
    and 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' = any(allowed_mime_types)) = 1, 'a private bucket';

  -- Uploading: into Club info any reader; a seat's folder, its holder or the NEC officers.
  assert pg_temp.try_as(pg_temp.u(4), format(up, 'club/info/a.pdf')) is not null, 'a plain member can''t upload';
  assert pg_temp.try_as(pg_temp.u(7), format(up, 'club/info/a.pdf')) is not null, 'Family can''t';
  assert pg_temp.try_as(pg_temp.u(8), format(up, 'club/info/a.pdf')) is not null, 'an applicant can''t';
  assert pg_temp.try_as(pg_temp.u(3), format(up, 'club/info/a.pdf')) is null, 'the West Secretary can, into Club info';
  assert pg_temp.try_as(pg_temp.u(5), format(up, 'club/info/b.pdf')) is null, 'so can the North President';
  assert pg_temp.try_as(pg_temp.u(3), format(up, wt || 'c.xlsx')) is not null, 'the Secretary can''t, into the Treasurer''s';
  assert pg_temp.try_as(pg_temp.u(6), format(up, wt || 'c.xlsx')) is not null, 'nor can a past Treasurer';
  assert pg_temp.try_as(pg_temp.u(5), format(up, wt || 'c.xlsx')) is not null, 'nor another chapter''s President';
  assert pg_temp.try_as(pg_temp.u(2), format(up, wt || 'c.xlsx')) is null, 'the West Treasurer can';
  assert pg_temp.try_as(pg_temp.u(1), format(up, nt || 'd.pdf')) is null, 'the Chairman stocks a vacant seat';
  assert pg_temp.try_as(pg_temp.u(1), format(up, 'club/nec_chair/e.docx')) is null, 'and the Chairman''s own';
  assert pg_temp.try_as(pg_temp.u(5), format(up, 'club/nec_chair/f.docx')) is not null, 'a President can''t, there';
  assert pg_temp.try_as(pg_temp.u(1), format(up, 'club/nec_auditor/g.pdf')) is not null, 'the Auditor has no folder';
  assert pg_temp.try_as(pg_temp.u(1), format(up, pg_temp.west() || '/tail_gunner/g.pdf')) is not null, 'nor a Tail Gunner';
  assert pg_temp.try_as(pg_temp.u(1), format(up, 'club/info/x/g.pdf')) is not null, 'no folders inside folders';
  assert pg_temp.try_as(pg_temp.u(1), format(up, 'west/treasurer/g.pdf')) is not null, 'a chapter by its id';
  assert pg_temp.try_as(pg_temp.u(1), format(up, repeat('a', 36) || '/treasurer/g.pdf')) like 'new row violates%', 'a non-id refused cleanly';

  -- Adding: the refusals in the app's words.
  assert pg_temp.try_as(null, format('select ' || add, 'null', null, 'club/info/a.pdf', 'A.pdf', 'null')) is not null, 'signed out';
  assert pg_temp.try_as(pg_temp.u(8), format('select ' || add, 'null', null, 'club/info/a.pdf', 'A.pdf', 'null')) = 'Only approved members can do that.';
  assert pg_temp.try_as(pg_temp.u(4), format('select ' || add, 'null', null, 'club/info/a.pdf', 'A.pdf', 'null')) = readers;
  assert pg_temp.try_as(pg_temp.u(7), format('select ' || add, 'null', null, 'club/info/a.pdf', 'A.pdf', 'null')) = readers;
  assert pg_temp.try_as(pg_temp.u(1), format('select ' || add, 'null', 'nec_auditor', 'club/nec_auditor/g.pdf', 'G.pdf', 'null'))
    = 'That folder isn’t one the club has.';
  assert pg_temp.try_as(pg_temp.u(1), format('select ' || add, quote_literal(pg_temp.west()), null, 'x', 'G.pdf', 'null'))
    = 'That folder isn’t one the club has.';
  assert pg_temp.try_as(pg_temp.u(3), format('select ' || add, quote_literal(pg_temp.west()), 'treasurer', wt || 'c.xlsx', 'C.xlsx', 'null')) = seat;
  assert pg_temp.try_as(pg_temp.u(3), format('select ' || add, 'null', null, 'club/info/a.exe', 'A.exe', 'null'))
    = 'Pick a PDF, photo, Word, Excel or text file.';
  assert pg_temp.try_as(pg_temp.u(3), format('select ' || add, 'null', null, 'club/info/a.pdf', 'A.pdf', '20971521'))
    = 'That file is over 20 MB. Save a smaller copy and try again.';
  assert pg_temp.try_as(pg_temp.u(3), format('select ' || add, 'null', null, 'club/info/zz.pdf', 'Z.pdf', 'null'))
    = 'That file didn’t upload. Try again.', 'not in Storage';
  assert pg_temp.try_as(pg_temp.u(2), format('select ' || add, 'null', null, wt || 'c.xlsx', 'C.xlsx', 'null'))
    = 'That file didn’t upload. Try again.', 'not under the folder it names';

  info := pg_temp.value_as(pg_temp.u(3), format(add, 'null', null, 'club/info/a.pdf', '  Insurance 2026.pdf  ', '1234'))::uuid;
  assert (select name from board_files where id = info) = 'Insurance 2026.pdf', 'the name is trimmed';
  assert (select added_by from board_files where id = info) = pg_temp.u(3), 'who added it';
  assert pg_temp.try_as(pg_temp.u(3), format('select ' || add, 'null', null, 'club/info/a.pdf', 'Again.pdf', 'null'))
    = 'That file didn’t upload. Try again.', 'a path is filed once';
  assert pg_temp.value_as(pg_temp.u(5), format(add, 'null', null, 'club/info/b.pdf', '   ', 'null')) is not null, 'blank name';
  assert (select name from board_files where path = 'club/info/b.pdf') = 'Board file.pdf';
  budget := pg_temp.value_as(pg_temp.u(2), format(add, quote_literal(pg_temp.west()), 'treasurer', wt || 'c.xlsx', 'Budget.xlsx', '99'))::uuid;
  assert pg_temp.value_as(pg_temp.u(1), format(add, quote_literal(pg_temp.north()), 'treasurer', nt || 'd.pdf', 'Handover.pdf', 'null')) is not null;
  assert pg_temp.value_as(pg_temp.u(1), format(add, 'null', 'nec_chair', 'club/nec_chair/e.docx', 'Chair.docx', 'null')) is not null;

  -- Reading: the rows and the bytes, board members of any chapter and the NEC only.
  assert pg_temp.value_as(pg_temp.u(5), '(select count(*) from board_files)') = '5', 'the North President reads every folder';
  assert pg_temp.value_as(pg_temp.u(3), '(select count(*) from board_files)') = '5', 'so does the West Secretary';
  assert pg_temp.value_as(pg_temp.u(1), '(select count(*) from board_files)') = '5', 'and the Chairman';
  assert pg_temp.value_as(pg_temp.u(4), '(select count(*) from board_files)') = '0', 'a plain member reads none';
  assert pg_temp.value_as(pg_temp.u(6), '(select count(*) from board_files)') = '0', 'nor a past Treasurer';
  assert pg_temp.value_as(pg_temp.u(7), '(select count(*) from board_files)') = '0', 'nor Family';
  assert pg_temp.value_as(pg_temp.u(5), $q$(select count(*) from storage.objects where bucket_id = 'board-files')$q$) = '5', 'the bytes too';
  assert pg_temp.value_as(pg_temp.u(4), $q$(select count(*) from storage.objects where bucket_id = 'board-files')$q$) = '0', 'not for a member';
  assert pg_temp.try_as(pg_temp.u(3), $q$insert into board_files (path, name) values ('club/info/q.pdf', 'Q.pdf')$q$) is not null, 'no direct writes';
  assert pg_temp.try_as(pg_temp.u(3), format('update board_files set name = %L', 'X')) is not null, 'no direct changes';
  assert (select count(*) from board_files where name = 'X') = 0, 'but nothing changes';

  -- Tidying: only a path no file uses, by the folder's writer.
  assert pg_temp.try_as(pg_temp.u(2), format(up, wt || 'orphan.pdf')) is null;
  assert pg_temp.try_as(pg_temp.u(3), format($q$delete from storage.objects where bucket_id = 'board-files' and name = %L$q$, wt || 'orphan.pdf')) is null;
  assert (select count(*) from storage.objects where name = wt || 'orphan.pdf') = 1, 'not the Secretary';
  assert pg_temp.try_as(pg_temp.u(2), format($q$delete from storage.objects where bucket_id = 'board-files' and name = %L$q$, wt || 'c.xlsx')) is null;
  assert (select count(*) from storage.objects where name = wt || 'c.xlsx') = 1, 'a filed one stays';
  assert pg_temp.try_as(pg_temp.u(2), format($q$delete from storage.objects where bucket_id = 'board-files' and name = %L$q$, wt || 'orphan.pdf')) is null;
  assert (select count(*) from storage.objects where name = wt || 'orphan.pdf') = 0, 'the Treasurer tidies the orphan';

  -- Removing: the folder's writer, whoever added it; the bytes go on the purge queue.
  assert pg_temp.try_as(pg_temp.u(4), format('select public.remove_board_file(%L)', budget)) = readers;
  assert pg_temp.try_as(pg_temp.u(3), format('select public.remove_board_file(%L)', budget)) = seat;
  assert pg_temp.try_as(pg_temp.u(3), format('select public.remove_board_file(%L)', gen_random_uuid())) = 'That file isn’t in board files.';
  assert pg_temp.try_as(pg_temp.u(5), format('select public.remove_board_file(%L)', info)) is null, 'Club info: any reader';
  assert (select count(*) from board_files where id = info) = 0, 'gone';
  assert (select count(*) from private.storage_purge where bucket = 'board-files' and path = 'club/info/a.pdf' and done_at is null) = 1, 'queued';
  assert pg_temp.try_as(pg_temp.u(1), format('select public.remove_board_file(%L)', budget)) is null, 'the Chairman tidies a seat';
  assert (select count(*) from private.storage_purge where bucket = 'board-files' and path = wt || 'c.xlsx') = 1, 'queued';

  -- Files belong to the seat: a new Treasurer can change what the last one filed.
  assert pg_temp.try_as(pg_temp.u(2), format(up, wt || 'h.pdf')) is null;
  budget := pg_temp.value_as(pg_temp.u(2), format(add, quote_literal(pg_temp.west()), 'treasurer', wt || 'h.pdf', 'Bank letter.pdf', 'null'))::uuid;
  update positions set ended_on = current_date where member_id = pg_temp.u(2) and role = 'treasurer';
  insert into positions (member_id, chapter_id, role, started_on) values (pg_temp.u(4), pg_temp.west()::uuid, 'treasurer', current_date);
  assert pg_temp.try_as(pg_temp.u(2), format('select public.remove_board_file(%L)', budget)) = readers, 'the old Treasurer has left the board';
  assert pg_temp.value_as(pg_temp.u(4), '(select count(*) from board_files)') = '4', 'the new one reads the folders';
  assert pg_temp.try_as(pg_temp.u(4), format('select public.remove_board_file(%L)', budget)) is null, 'and tidies the seat''s files';

  -- An account deleted keeps the files; who added them goes blank.
  delete from members where id = pg_temp.u(5);
  assert (select count(*) from board_files where path = 'club/info/b.pdf' and added_by is null) = 1, 'the file stays';
end $$;

\echo 'All board files checks passed'
