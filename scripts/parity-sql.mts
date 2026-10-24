// Turns the shared who-can-do-what cases (supabase/tests/parity.json) into SQL that runs each
// case against the real database rules, expecting exactly the demo's answer: allowed, or refused
// with the demo's own message. Used by scripts/test-db.sh (via tsx); prints SQL to stdout.

import { readGpx } from '../src/domain/gpx';
import { caseAction, demoAnswer, fixture as fx, fixtureGpx, type ParityCase } from '../src/data/parityFixture.testkit';

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
    `insert into public.members (id, chapter_id, full_name, status, approval, share_phone, joined_on, on_hiatus) values (` +
      `${id('m', m.key)}, ${chapter(m.chapter)}, ${q(m.name)}, ${q(m.status)}, ${q(m.approval)}, ${m.sharePhone}, ` +
      `${m.approval === 'approved' ? "date '2024-01-01'" : 'null'}, ${m.onHiatus ?? false});`,
  );
  sql(
    `insert into public.member_private (member_id, email, first_aid_expiry) values (` +
      `${id('m', m.key)}, ${q(`${m.key}@example.com`)}, ${date(m.firstAidExpiry ?? null)});`,
  );
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

for (const k of fx.crew ?? []) {
  sql(
    `insert into public.ride_crew (ride_id, member_id, role) values (` +
      `${id('r', k.ride)}, ${id('m', k.member)}, ${q(k.role)});`,
  );
}
for (const r of fx.rsvps ?? []) {
  sql(
    `insert into public.rsvps (ride_id, member_id, answer) values (` +
      `${id('r', r.ride)}, ${id('m', r.member)}, ${q(r.answer)});`,
  );
}
// Stage 3 (lane B): chats. The chats themselves make themselves; private chats, blocks and
// messages are added here. A fixture chat name becomes a lookup of its id.
const chatId = (name: string): string => {
  const [kind, a, b] = name.split(':');
  const where =
    kind === 'club' || kind === 'nec' ? `kind = ${q(kind)}`
    : kind === 'committee' ? `kind = 'committee' and committee = ${q(a)}`
    : kind === 'chapter' || kind === 'board' ? `kind = ${q(kind)} and chapter_id = ${chapter(a)}`
    : kind === 'ride' ? `kind = 'ride' and ride_id = ${id('r', a)}`
    : kind === 'direct' ? `direct_key = least(${id('m', a)}::text, ${id('m', b)}::text) || ':' || greatest(${id('m', a)}::text, ${id('m', b)}::text)`
    : null;
  if (!where) throw new Error(`Unknown chat ${name}`);
  return `(select id from public.conversations where ${where})`;
};
for (const [a, b] of fx.directs ?? []) {
  sql(
    `insert into public.conversations (kind, direct_key) values ('direct', ` +
      `least(${id('m', a)}::text, ${id('m', b)}::text) || ':' || greatest(${id('m', a)}::text, ${id('m', b)}::text));`,
  );
  sql(`insert into public.conversation_members (conversation_id, member_id) values (${chatId(`direct:${a}:${b}`)}, ${id('m', a)}), (${chatId(`direct:${a}:${b}`)}, ${id('m', b)});`);
}
for (const b of fx.blocks ?? []) {
  sql(`insert into public.member_blocks (blocker_id, blocked_id) values (${id('m', b.blocker)}, ${id('m', b.blocked)});`);
}
for (const m of fx.messages ?? []) {
  sql(
    `insert into public.messages (id, conversation_id, author_id, body, removed_at) values (` +
      `${id('msg', m.key)}, ${chatId(m.chat)}, ${id('m', m.author)}, ${m.removed ? 'null' : q(m.body)}, ${m.removed ? 'now()' : 'null'});`,
  );
}
// Looked up as the database owner before each case, since the person in the case may not be able
// to see the chat at all.
const caseChat = `nullif(current_setting('parity.chat'), '')::uuid`;
const text = (s: string, repeat?: number) => q(repeat ? s.repeat(repeat) : s);
const gifs = (n = 0) =>
  `${q(JSON.stringify(Array.from({ length: n }, (_, i) => ({ kind: 'gif', path: `https://media1.giphy.com/media/parity${i}/giphy.gif`, width: 220, height: 160 }))))}::jsonb`;

const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const routeFile = fixtureGpx(fx.routes?.length ? 'valid' : null);
const routeSummary = routeFile === null ? null : readGpx(routeFile);
if (typeof routeSummary === 'string') throw new Error(`parity.json's valid GPX file: ${routeSummary}`);
for (const r of fx.routes ?? []) {
  sql(
    `insert into public.routes (id, name, chapter_id, gpx, distance_m, climb_m, line, stops, bounds, archived_at) values (` +
      `${id('rt', r.key)}, ${q(r.name)}, ${chapter(r.chapter)}, ${q(routeFile)}, ${routeSummary!.distanceM}, ` +
      `${routeSummary!.climbM ?? 'null'}, ${json(routeSummary!.line)}, ${json(routeSummary!.stops)}, ${json(routeSummary!.bounds)}, ` +
      `${r.archived ? "'2026-01-01T00:00:00Z'" : 'null'});`,
  );
}
for (const r of fx.rideRoutes ?? []) {
  sql(`insert into public.ride_routes (ride_id, route_id) values (${id('r', r.ride)}, ${id('rt', r.route)});`);
}

/** A saveRoute call with the summary the app sends: read from the file, as LiveClubProvider does. */
const saveRouteCall = (c: ParityCase & Record<string, any>): string => {
  const a = caseAction(c) as Extract<ReturnType<typeof caseAction>, { action: 'saveRoute' }>;
  const read = a.gpx === null ? null : readGpx(a.gpx);
  const s = read !== null && typeof read === 'object' ? read : null;
  return (
    `public.save_route(${a.route ? id('rt', a.route) : 'null'}, ${q(a.routeName.trim())}, ${chapter(a.chapter)}, ` +
    `${a.notes?.trim() ? q(a.notes.trim()) : 'null'}, ${a.gpx === null ? 'null' : q(a.gpx)}, ${s ? s.distanceM : 'null'}, ` +
    `${s?.climbM ?? 'null'}, ${s ? json(s.line) : 'null'}, ${s ? json(s.stops) : 'null'}, ${s ? json(s.bounds) : 'null'})`
  );
};

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
    case 'crew':
      return `public.set_crew(${id('r', c.ride)}, ${id('m', c.member)}, ${q(c.role)})`;
    case 'leaveCrew':
      return `public.leave_crew(${id('r', c.ride)}, ${id('m', c.member)})`;
    case 'saveRoute':
      return saveRouteCall(c);
    case 'archiveRoute':
      return `public.archive_route(${id('rt', c.route)})`;
    case 'setRideRoute':
      return `public.set_ride_route(${id('r', c.ride)}, ${c.route ? id('rt', c.route) : 'null'})`;
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
    case 'chatSend':
      return `public.send_message(${caseChat}, ${text(c.body, c.repeat)}, ${gifs(c.gifs)}, ${c.replyTo ? id('msg', c.replyTo) : 'null'})`;
    case 'chatRemove':
      return `public.remove_message(${id('msg', c.message)})`;
    case 'chatReact':
      return `public.toggle_reaction(${id('msg', c.message)}, ${q(c.emoji)})`;
    case 'chatDirect':
      return `public.open_direct_chat(${id('m', c.member)})`;
    case 'chatPin':
      return `public.pin_message(${caseChat}, ${c.message ? id('msg', c.message) : 'null'})`;
    case 'chatReport':
      return `public.report_message(${id('msg', c.message)}, ${text(c.reason, c.repeat)})`;
    case 'chatBlock':
      return `public.set_block(${id('m', c.member)}, ${c.blocked})`;
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
  sql(`select set_config('parity.chat', coalesce(${c.chat ? chatId(String(c.chat)) : 'null'}::text, ''), true);`);
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
