-- Checks the document library: who reads what through club_documents() and document_body(), who
-- publishes, every action allowed and refused (with the app's words), version approval, review and
-- sign-off. Run with: npm run test:db

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

-- d1 West President and National Chairman, d2 West Secretary, d3 West Full, d4 North President,
-- d5 North Full, d6 North Vice President, d8 West Legacy, d9 applicant.
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-0000-0000-0000000000d' || n)::uuid, 'd' || n || '@example.com', now()
from generate_series(1, 9) n;

insert into members (id, chapter_id, full_name, road_name, status, approval)
select v.id::uuid, (select id from chapters where slug = v.ch), v.name, null, v.status::member_status, v.approval::approval_state
from (values
  ('00000000-0000-0000-0000-0000000000d1', 'west', 'Wes President', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d2', 'west', 'Sue Secretary', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d3', 'west', 'Fred Full', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d4', 'north', 'Nora President', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d5', 'north', 'Ned North', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d6', 'north', 'Vic Vice', 'full', 'approved'),
  ('00000000-0000-0000-0000-0000000000d8', 'west', 'Len Legacy', 'legacy', 'approved'),
  ('00000000-0000-0000-0000-0000000000d9', 'west', 'Al Applicant', 'introduced', 'pending')
) as v(id, ch, name, status, approval);

insert into positions (member_id, chapter_id, role, started_on)
values
  ('00000000-0000-0000-0000-0000000000d1', (select id from chapters where slug = 'west'), 'president', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000d1', null, 'nec_chair', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000d2', (select id from chapters where slug = 'west'), 'secretary', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000d4', (select id from chapters where slug = 'north'), 'president', '2025-08-16'),
  ('00000000-0000-0000-0000-0000000000d6', (select id from chapters where slug = 'north'), 'vice_president', '2025-08-16');

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

create function pg_temp.docs_as(who uuid) returns jsonb language sql as $$
  select pg_temp.value_as(who, 'public.club_documents()')::jsonb
$$;
create function pg_temp.west() returns uuid language sql as $$ select id from chapters where slug = 'west' $$;
create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000d' || n)::uuid $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Australia/Melbourne')::date $$;

grant execute on function pg_temp.try_as(uuid, text), pg_temp.value_as(uuid, text), pg_temp.docs_as(uuid),
  pg_temp.west(), pg_temp.u(int), pg_temp.today() to anon, authenticated;

create temp table ids (name text primary key, id uuid);
grant all on ids to anon, authenticated;

\o
\echo 'Nobody reaches the tables directly'
do $$
declare t text;
begin
  foreach t in array array['documents', 'document_versions', 'document_signoffs'] loop
    assert pg_temp.try_as(pg_temp.u(1), format('select count(*) from public.%I', t)) is not null, 'read ' || t;
    assert pg_temp.try_as(null, format('select count(*) from public.%I', t)) is not null, 'anon read ' || t;
  end loop;
  assert pg_temp.try_as(null, 'select public.club_documents()') is not null, 'anon can''t call club_documents';
  assert pg_temp.try_as(pg_temp.u(1), 'select private.document_in_force(gen_random_uuid(), current_date)') is not null, 'the helper is private';
end $$;

\echo 'Adding documents: who, and the refusals'
do $$
begin
  assert pg_temp.try_as(pg_temp.u(9), $q$select public.create_document(null, 'policy', 'X', false, null)$q$)
    = 'Only approved members can do that.', 'applicant';
  assert pg_temp.try_as(pg_temp.u(2), $q$select public.create_document(null, 'policy', 'X', false, null)$q$)
    = 'Only the NEC can do that.', 'a chapter Secretary, club-wide';
  assert pg_temp.try_as(pg_temp.u(6), format($q$select public.create_document(%L, 'policy', 'X', false, null)$q$, pg_temp.west()))
    = 'Only that chapter’s board can do that.', 'North VP, a West document';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.create_document(%L, 'constitution', 'X', false, null)$q$, pg_temp.west()))
    = 'The Registered Rules and the Constitution are club-wide documents.', 'a chapter constitution';
  assert pg_temp.try_as(pg_temp.u(1), $q$select public.create_document(null, 'policy', '   ', false, null)$q$)
    = 'Give the document a title.', 'no title';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.create_document(null, 'policy', %L, false, null)$q$, repeat('x', 121)))
    = 'Keep the title to 120 characters at most.', 'long title';
  assert pg_temp.try_as(pg_temp.u(1), $q$select public.create_document(null, 'policy', 'X', false, 61)$q$)
    = 'Pick a review cycle from 1 to 60 months, or none.', 'review 61';
  assert pg_temp.try_as(pg_temp.u(1), $q$select public.create_document(null, 'policy', 'X', false, 0)$q$)
    = 'Pick a review cycle from 1 to 60 months, or none.', 'review 0';

  insert into ids select 'const', pg_temp.value_as(pg_temp.u(1), $q$public.create_document(null, 'constitution', ' Constitution ', false, 12)$q$)::uuid;
  assert (select title from documents where id = (select ids.id from ids where name = 'const')) = 'Constitution', 'title trimmed';
  assert pg_temp.try_as(pg_temp.u(1), $q$select public.create_document(null, 'constitution', 'Again', false, null)$q$)
    = 'The library already has that document. Publish a new version of it instead.', 'a second constitution';
  insert into ids select 'fees', pg_temp.value_as(pg_temp.u(1), $q$public.create_document(null, 'policy', 'Fee schedule', false, 12)$q$)::uuid;
  insert into ids select 'west', pg_temp.value_as(pg_temp.u(2), format($q$public.create_document(%L, 'policy', 'West bylaws', true, null)$q$, pg_temp.west()))::uuid;
  assert (select created_by from documents where id = (select ids.id from ids where name = 'west')) = pg_temp.u(2), 'created by';
end $$;

\echo 'Publishing versions'
do $$
declare c uuid := (select id from ids where name = 'const'); w uuid := (select id from ids where name = 'west');
        f uuid := (select id from ids where name = 'fees');
begin
  assert pg_temp.try_as(pg_temp.u(1), $q$select public.publish_document_version(gen_random_uuid(), 0, 'v1', 'x', '', true, null, null, null)$q$)
    = 'That document isn’t in the library.', 'no document';
  assert pg_temp.try_as(pg_temp.u(5), format($q$select public.publish_document_version(%L, 0, 'v1', 'x', '', true, null, null, null)$q$, w))
    = 'Only that chapter’s board can do that.', 'a North member';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.publish_document_version(%L, 1, 'v1', 'x', '', true, null, null, null)$q$, c))
    like 'Someone else published a new version while you were editing.%', 'stale';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.publish_document_version(%L, 0, ' ', 'x', '', true, null, null, null)$q$, c))
    = 'Give the version a label, like v2.', 'no label';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.publish_document_version(%L, 0, %L, 'x', '', true, null, null, null)$q$, c, repeat('x', 21)))
    = 'Keep the label to 20 characters at most.', 'long label';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.publish_document_version(%L, 0, 'v4', E'\n ', '', true, null, null, null)$q$, c))
    = 'Write the document’s text first.', 'no text';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.publish_document_version(%L, 0, 'v4', %L, '', true, null, null, null)$q$, c, repeat('x', 200001)))
    = 'That’s too long (200000 characters at most).', 'long text';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.publish_document_version(%L, 0, 'v4', 'x', %L, true, null, null, null)$q$, c, repeat('x', 501)))
    = 'Keep what changed to 500 characters at most.', 'long changes';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.publish_document_version(%L, 0, 'v4', 'x', '', true, 'nec', null, null)$q$, c))
    = 'Give the approving body, the approval date and the commencement date together.', 'part approval';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.publish_document_version(%L, 0, 'v4', 'x', '', true, 'the pub', current_date - 1, current_date)$q$, c))
    = 'Pick who approved it.', 'unknown body';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.publish_document_version(%L, 0, 'v4', 'x', '', true, 'nec', %L::date + 1, %L::date + 2)$q$, c, pg_temp.today(), pg_temp.today()))
    = 'The approval date can’t be in the future.', 'future';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.publish_document_version(%L, 0, 'v4', 'x', '', true, 'nec', %L::date, %L::date - 1)$q$, c, pg_temp.today(), pg_temp.today()))
    = 'It can’t commence before it was approved.', 'commences first';

  -- v4 goes in awaiting approval.
  insert into ids select 'v4', pg_temp.value_as(pg_temp.u(1), format($q$public.publish_document_version(%L, 0, ' v4 ', ' # Text ', '', false, null, null, null)$q$, c))::uuid;
  assert (select (number, label, body, fresh_sign_off, approved_on is null, published_by) from document_versions
          where id = (select id from ids where name = 'v4')) = (1, 'v4'::text, '# Text'::text, true, true, pg_temp.u(1)), 'v4 stored, version 1 asks for sign-off';
  -- The fee schedule, in force since last year; West's bylaws v1 then v2 without a fresh sign-off.
  perform pg_temp.value_as(pg_temp.u(1), format($q$public.publish_document_version(%L, 0, '2025', 'Fees', '', true, 'nec', %L::date - 400, %L::date - 380)$q$, f, pg_temp.today(), pg_temp.today()));
  insert into ids select 'w1', pg_temp.value_as(pg_temp.u(2), format($q$public.publish_document_version(%L, 0, 'v1', 'One', '', true, 'chapter_board', %L::date - 30, %L::date - 30)$q$, w, pg_temp.today(), pg_temp.today()))::uuid;
  assert pg_temp.try_as(pg_temp.u(4), format($q$select public.publish_document_version(%L, 1, 'v2', 'Two', 'Small fix', false, 'chapter_board', %L::date - 2, %L::date - 1)$q$, w, pg_temp.today(), pg_temp.today()))
    = 'Only that chapter’s board can do that.', 'North''s President (on the NEC) doesn''t publish West''s';
  insert into ids select 'w2', pg_temp.value_as(pg_temp.u(2), format($q$public.publish_document_version(%L, 1, 'v2', 'Two', 'Small fix', false, 'chapter_board', %L::date - 2, %L::date - 1)$q$, w, pg_temp.today(), pg_temp.today()))::uuid;
  assert (select (number, fresh_sign_off, published_by) from document_versions where id = (select id from ids where name = 'w2'))
    = (2, false, pg_temp.u(2)), 'v2 by West''s board, no fresh sign-off';
end $$;

\echo 'Recording approval later'
do $$
declare v4 uuid := (select id from ids where name = 'v4');
begin
  assert pg_temp.try_as(pg_temp.u(1), $q$select public.record_document_approval(gen_random_uuid(), 'nec', current_date, current_date)$q$)
    = 'That version isn’t in the library.', 'no version';
  assert pg_temp.try_as(pg_temp.u(2), format($q$select public.record_document_approval(%L, 'nec', current_date, current_date)$q$, v4))
    = 'Only the NEC can do that.', 'a chapter Secretary';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.record_document_approval(%L, null, null, null)$q$, v4))
    = 'Give the approving body, the approval date and the commencement date together.', 'nothing given';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.record_document_approval(%L, 'association_general_meeting', %L::date, %L::date + 5)$q$, v4, pg_temp.today(), pg_temp.today())) is null, 'recorded';
  assert (select (approving_body, commences_on) from document_versions where id = v4) = ('association_general_meeting'::text, pg_temp.today() + 5), 'stored';
  assert pg_temp.try_as(pg_temp.u(1), format($q$select public.record_document_approval(%L, 'nec', %L::date, %L::date)$q$, v4, pg_temp.today(), pg_temp.today()))
    = 'Its approval is already recorded.', 'twice';
end $$;

\echo 'Marking reviewed'
do $$
begin
  assert pg_temp.try_as(pg_temp.u(1), 'select public.mark_document_reviewed(gen_random_uuid())') = 'That document isn’t in the library.', 'no document';
  assert pg_temp.try_as(pg_temp.u(2), format('select public.mark_document_reviewed(%L)', (select id from ids where name = 'fees')))
    = 'Only the NEC can do that.', 'a chapter Secretary';
  assert pg_temp.try_as(pg_temp.u(2), format('select public.mark_document_reviewed(%L)', (select id from ids where name = 'west')))
    = 'This document has no review cycle.', 'no cycle';
  assert pg_temp.try_as(pg_temp.u(1), format('select public.mark_document_reviewed(%L)', (select id from ids where name = 'const')))
    = 'Nothing is in force yet, so there’s nothing to review.', 'v4 commences in five days';
  assert pg_temp.try_as(pg_temp.u(1), format('select public.mark_document_reviewed(%L)', (select id from ids where name = 'fees'))) is null, 'reviewed';
  assert (select reviewed_on from documents where id = (select id from ids where name = 'fees')) = pg_temp.today(), 'today';
end $$;

\echo 'Signing'
do $$
declare w1 uuid := (select id from ids where name = 'w1'); w2 uuid := (select id from ids where name = 'w2');
begin
  assert pg_temp.try_as(pg_temp.u(9), format('select public.sign_document(%L)', w2)) = 'Only approved members can do that.', 'applicant';
  assert pg_temp.try_as(pg_temp.u(3), 'select public.sign_document(gen_random_uuid())') = 'That version isn’t in the library.', 'no version';
  assert pg_temp.try_as(pg_temp.u(3), format('select public.sign_document(%L)', (select id from ids where name = 'v4')))
    = 'This document doesn’t ask for sign-off.', 'v4 doesn''t ask';
  assert pg_temp.try_as(pg_temp.u(5), format('select public.sign_document(%L)', w2)) = 'You’re not asked to sign this document.', 'North member';
  assert pg_temp.try_as(pg_temp.u(8), format('select public.sign_document(%L)', w2)) = 'You’re not asked to sign this document.', 'Legacy';
  assert pg_temp.try_as(pg_temp.u(3), format('select public.sign_document(%L)', w1))
    = 'That version isn’t the one in force. Open the document again, then sign.', 'superseded';
  assert pg_temp.try_as(pg_temp.u(3), format('select public.sign_document(%L)', w2)) is null, 'signed';
  update document_signoffs set signed_at = now() - interval '1 day';
  assert pg_temp.try_as(pg_temp.u(3), format('select public.sign_document(%L)', w2)) is null, 'signed again';
  assert (select count(*) from document_signoffs) = 1 and (select signed_at > now() - interval '1 minute' from document_signoffs), 'one row, date moved';
end $$;

\echo 'Reading'
do $$
declare d jsonb;
begin
  -- Approved members, Legacy included, read everything, without the text.
  d := pg_temp.docs_as(pg_temp.u(8));
  assert jsonb_array_length(d->'documents') = 3 and jsonb_array_length(d->'versions') = 4, 'Legacy reads all';
  assert not (d->'versions'->0 ? 'body'), 'no text in the list';
  -- Applicants read only the Registered Rules and the Constitution (15.7).
  d := pg_temp.docs_as(pg_temp.u(9));
  assert (select array_agg(x->>'kind') from jsonb_array_elements(d->'documents') x) = array['constitution'], 'applicant list';
  assert jsonb_array_length(d->'versions') = 1, 'applicant versions';
  assert pg_temp.value_as(pg_temp.u(9), format('public.document_body(%L)', (select id from ids where name = 'v4'))) = '# Text', 'applicant reads v4';
  assert pg_temp.value_as(pg_temp.u(9), format('public.document_body(%L)', (select id from ids where name = 'w2'))) is null, 'applicant can''t read bylaws';
  assert pg_temp.value_as(pg_temp.u(5), format('public.document_body(%L)', (select id from ids where name = 'w2'))) = 'Two', 'member reads bylaws';
  -- Sign-offs: your own, or all of a document you publish.
  assert jsonb_array_length(pg_temp.docs_as(pg_temp.u(3))->'signoffs') = 1, 'the signer sees theirs';
  assert jsonb_array_length(pg_temp.docs_as(pg_temp.u(5))->'signoffs') = 0, 'another member doesn''t';
  assert jsonb_array_length(pg_temp.docs_as(pg_temp.u(2))->'signoffs') = 1, 'West''s board does';
  assert jsonb_array_length(pg_temp.docs_as(pg_temp.u(6))->'signoffs') = 0, 'North''s VP doesn''t';
  assert jsonb_array_length(pg_temp.docs_as(pg_temp.u(9))->'signoffs') = 0, 'nor an applicant';
end $$;

\echo 'All document library checks passed'
