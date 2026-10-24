// Turns the shared who-can-do-what cases (supabase/tests/parity.json) into SQL that runs each
// case against the real database rules, expecting exactly the demo's answer: allowed, or refused
// with the demo's own message. Used by scripts/test-db.sh (via tsx); prints SQL to stdout.

import { demoAnswer, fixture as fx, type ParityCase } from '../src/data/parityFixture.testkit';

const q = (s: unknown) => `'${String(s).replace(/'/g, "''")}'`;
const id = (kind: string, key: string) => `md5(${q(`${kind}:${key}`)})::uuid`;
const chapter = (slug: string | null) => (slug === null ? 'null' : `(select id from public.chapters where slug = ${q(slug)})`);
const date = (d: string | null) => (d === null ? 'null' : `date ${q(d)}`);

const out: string[] = [];
const sql = (s: string) => out.push(s);

sql('\\set ON_ERROR_STOP 1');
sql('\\set QUIET 1');
sql('\\o /dev/null');
sql("set client_min_messages = warning;");
sql('-- Fixture (as the database owner, so row-level security does not apply while setting up)');
for (const c of fx.chapters ?? []) {
  sql(`insert into public.chapters (slug, name, area) values (${q(c.slug)}, ${q(c.name)}, ${q(c.area)});`);
}
for (const m of fx.members) {
  sql(`insert into auth.users (id, email) values (${id('m', m.key)}, ${q(`${m.key}@example.com`)});`);
  sql(
    `insert into public.members (id, chapter_id, full_name, status, approval, share_phone, joined_on, fng_started_on) values (` +
      `${id('m', m.key)}, ${chapter(m.chapter)}, ${q(m.name)}, ${q(m.status)}, ${q(m.approval)}, ${m.sharePhone}, ` +
      `${m.approval === 'approved' ? "date '2024-01-01'" : 'null'}, ${m.fngStartedOn ? `date ${q(m.fngStartedOn)}` : 'null'});`,
  );
  sql(`insert into public.member_private (member_id, email) values (${id('m', m.key)}, ${q(`${m.key}@example.com`)});`);
}
for (const u of fx.signups ?? []) {
  // Signed up (email confirmed) but not applied yet.
  sql(`insert into auth.users (id, email) values (${id('m', u.key)}, ${q(`${u.key}@example.com`)});`);
}
for (const p of fx.positions) {
  sql(
    `insert into public.positions (id, member_id, chapter_id, role, started_on, ended_on) values (` +
      `${id('p', p.key)}, ${id('m', p.member)}, ${chapter(p.chapter)}, ${q(p.role)}, ${date(p.startedOn)}, ${date(p.endedOn)});`,
  );
}
for (const b of fx.bikes) {
  sql(
    `insert into public.bikes (id, member_id, make, model, year) values (` +
      `${id('b', b.key)}, ${id('m', b.member)}, ${q(b.make)}, ${q(b.model)}, ${b.year});`,
  );
}
for (const c of fx.contacts) {
  sql(
    `insert into public.emergency_contacts (id, member_id, name, relationship, phone) values (` +
      `${id('c', c.key)}, ${id('m', c.member)}, ${q(c.name)}, ${q(c.relationship)}, ${q(c.phone)});`,
  );
}

for (const r of fx.rides) {
  sql(
    `insert into public.rides (id, source, starts_at, title, category, cancelled_at) values (` +
      `${id('r', r.key)}, 'app', ${q(r.startsAt)}::timestamptz, ${q(r.title)}, ${q(r.category)}, ` +
      `${r.cancelled ? "'2026-01-01T00:00:00Z'" : 'null'});`,
  );
}

// Stage 5: meetings and votes
for (const x of fx.meetings) {
  sql(
    `insert into public.meetings (id, chapter_id, kind, title, starts_at, minutes, minutes_approved_at) values (` +
      `${id('mt', x.key)}, ${chapter(x.chapter)}, ${q(x.kind)}, ${q(x.title)}, ${q(x.startsAt)}::timestamptz, ` +
      `${x.minutes === null ? 'null' : q(x.minutes)}, ${x.approved ? "'2026-03-01T00:00:00Z'" : 'null'});`,
  );
}
for (const v of fx.votes) {
  sql(
    `insert into public.votes (id, chapter_id, question, electorate, threshold, quorum, opened_at, closes_at) values (` +
      `${id('v', v.key)}, ${chapter(v.chapter)}, ${q(v.key)}, ${q(v.electorate)}, ${q(v.threshold)}, ${v.quorum}, ` +
      `'2025-12-01T00:00:00Z', ${q(v.closesAt)}::timestamptz);`,
  );
  for (const e of v.electors) {
    const voted = v.ballots.some((b) => b.member === e);
    sql(`insert into public.vote_electors (vote_id, member_id, voted_at) values (${id('v', v.key)}, ${id('m', e)}, ${voted ? 'now()' : 'null'});`);
  }
  for (const b of v.ballots) {
    sql(`insert into public.vote_ballots (vote_id, member_id, choice) values (${id('v', v.key)}, ${id('m', b.member)}, ${q(b.choice)});`);
  }
}

const call = (c: ParityCase & Record<string, any>): string => {
  switch (c.action) {
    case 'appoint':
      return `public.appoint_position(${id('m', c.member)}, ${chapter(c.chapter)}, ${q(c.role)})`;
    case 'endTerm':
      return `public.end_position(${id('p', c.position)})`;
    case 'approve':
      return `public.approve_member(${id('m', c.member)}, ${q(c.status)})`;
    case 'decline':
      return `public.decline_member(${id('m', c.member)})`;
    case 'setStatus':
      return `public.set_member_status(${id('m', c.member)}, ${q(c.status)})`;
    case 'removeBike':
      return `public.remove_bike(${id('b', c.bike)})`;
    case 'rsvp':
      return `public.set_rsvp(${id('r', c.ride)}, ${q(c.answer)})`;
    case 'removeContact':
      return `public.remove_contact(${id('c', c.contact)})`;
    case 'saveBike':
      return `public.save_bike(${c.bike ? id('b', c.bike) : 'null'}, ${q(c.make)}, ${q(c.model)}, ${c.year ?? 'null'}, null, false, null, null)`;
    case 'saveContact':
      return `public.save_contact(${c.contact ? id('c', c.contact) : 'null'}, ${q(c.contactName)}, ${q(c.relationship)}, ${q(c.phone)})`;
    case 'apply':
      return (
        `public.apply_to_join(${chapter(c.chapter)}, ${q(c.fullName)}, null, null, null, null, 'introduced', ` +
        `${c.make ? q(c.make) : 'null'}, ${c.model ? q(c.model) : 'null'}, ${c.year ?? 'null'})`
      );
    // Stage 5: meetings and votes
    case 'saveMeeting':
      return `public.save_meeting(null, ${chapter(c.chapter)}, ${q(c.kind)}, ${q(c.title)}, ${q(c.startsAt)}::timestamptz, null, '[]')`;
    case 'approveMinutes':
      return `public.approve_minutes(${id('mt', c.meeting)})`;
    case 'saveActionItem':
      return `public.save_action_item(null, ${chapter(c.chapter)}, ${c.meeting ? id('mt', c.meeting) : 'null'}, ${q(c.title)}, ${id('m', c.owner)}, null)`;
    case 'openVote':
      return (
        `public.open_vote(${chapter(c.chapter)}, null, ${c.subject ? id('m', c.subject) : 'null'}, 'Shall we?', null, ` +
        `${q(c.electorate)}, ${q(c.threshold)}, ${c.secret ? 'true' : 'false'}, ${c.quorum}, now() + interval '${Number(c.days) * 24} hours')`
      );
    case 'castBallot':
      return `public.cast_ballot(${id('v', c.vote)}, ${q(c.choice)})`;
    case 'closeVote':
      return `public.close_vote(${id('v', c.vote)}, ${c.casting ? q(c.casting) : 'null'})`;
    default:
      throw new Error(`Unknown action ${c.action} in "${c.name}"`);
  }
};

sql('\\echo Parity: the demo and the database agree on who can do what');
for (const c of fx.cases) {
  const name = q(c.name);
  const expected = demoAnswer(c);
  if ((expected === null) !== c.allowed) {
    throw new Error(`The demo doesn't give the listed answer for "${c.name}" (npm test shows which).`);
  }
  sql('begin;');
  for (const key of c.without ?? []) sql(`delete from public.positions where id = ${id('p', key)};`);
  sql(`select set_config('request.jwt.claim.sub', ${id('m', c.as)}::text, true);`);
  sql('set local role authenticated;');
  sql('do $parity$ begin');
  sql('  begin');
  sql(`    perform ${call(c as ParityCase & Record<string, any>)};`);
  sql('  exception when others then');
  if (expected === null) {
    sql(`    raise exception 'PARITY: "%" should be allowed (as in the demo) but the database refused: %', ${name}, sqlerrm;`);
  } else {
    sql(`    if sqlerrm <> ${q(expected)} then`);
    sql(`      raise exception 'PARITY: "%" refused for a different reason. Demo: "%" Database: "%"', ${name}, ${q(expected)}, sqlerrm;`);
    sql('    end if;');
    sql('    return;');
  }
  sql('  end;');
  if (expected !== null) {
    sql(`  raise exception 'PARITY: "%" should be refused (as in the demo) but the database allowed it', ${name};`);
  }
  sql('end $parity$;');
  sql('rollback;');
}
sql(`\\echo '  ${fx.cases.length} cases agree, with the same refusal messages'`);

process.stdout.write(out.join('\n') + '\n');
