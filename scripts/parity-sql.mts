// Turns the shared who-can-do-what cases (supabase/tests/parity.json) into SQL that runs each
// case against the real database rules, expecting exactly the demo's answer: allowed, or refused
// with the demo's own message. Used by scripts/test-db.sh (via tsx); prints SQL to stdout.

// Stage 4
import { addDays } from '../src/domain/dates';
import { fyOf } from '../src/domain/fees';
import { readGpx } from '../src/domain/gpx';
import {
  BRIEFED_AT, caseAction, RULES_AT, demoAnswer, fixture as fx, fixtureGpx, fngStart, parityToday, resolveCase, type ParityCase,
} from '../src/data/parityFixture.testkit';

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
    `insert into public.members (id, chapter_id, full_name, status, approval, share_phone, joined_on, on_hiatus, fng_started_on) values (` +
      `${id('m', m.key)}, ${chapter(m.chapter)}, ${q(m.name)}, ${q(m.status)}, ${q(m.approval)}, ${m.sharePhone}, ` +
      `${m.approval === 'approved' ? "date '2024-01-01'" : 'null'}, ${m.onHiatus ?? false}, ${m.fngStartedOn ? `date ${q(m.fngStartedOn)}` : 'null'});`,
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
// Stage 4 fixture: check-ins, decisions and fees, dated from today.
const today = parityToday();
const s4 = fx.stage4;
if (s4) {
  for (const m of s4.members) {
    sql(`insert into auth.users (id, email) values (${id('m', m.key)}, ${q(`${m.key}@example.com`)});`);
    sql(
      `insert into public.members (id, chapter_id, full_name, status, approval, joined_on, fng_started_on) values (` +
        `${id('m', m.key)}, ${chapter(m.chapter)}, ${q(m.name)}, ${q(m.status)}, ${q(m.approval)}, ` +
        `${m.approval === 'approved' ? "date '2024-01-01'" : 'null'}, ${date(fngStart(m.fngStartMonths, today))});`,
    );
  }
  for (const p of s4.positions) {
    sql(
      `insert into public.positions (id, member_id, chapter_id, role, started_on) values (` +
        `${id('p', p.key)}, ${id('m', p.member)}, ${chapter(p.chapter)}, ${q(p.role)}, date '2025-01-01');`,
    );
  }
  for (const r of s4.rides) {
    sql(
      `insert into public.rides (id, source, starts_at, title, category, cancelled_at) values (` +
        `${id('r', r.key)}, 'app', ${q(r.startsAt)}::timestamptz, ${q(r.title)}, ${q(r.category)}, ` +
        `${r.cancelled ? "'2026-01-01T00:00:00Z'" : 'null'});`,
    );
  }
  for (const x of s4.sessions) {
    sql(
      `insert into public.checkin_sessions (id, kind, chapter_id, ride_id, title, held_on, code, closed_at) values (` +
        `${id('s', x.key)}, ${q(x.kind)}, ${chapter(x.chapter)}, ${x.ride ? id('r', x.ride) : 'null'}, ${q(x.title)}, ` +
        `${date(addDays(today, x.heldOnDays))}, ${q(x.code)}, ${x.closed ? "'2026-01-01T00:00:00Z'" : 'null'});`,
    );
  }
  for (const a of s4.attendance) {
    sql(`insert into public.attendance (session_id, member_id) values (${id('s', a.session)}, ${id('m', a.member)});`);
  }
  for (const r of s4.rates) {
    sql(
      `insert into public.fee_rates (chapter_id, fy, status, amount_cents, due_on) values (` +
        `${chapter(r.chapter)}, ${fyOf(today) + r.fyOffset}, ${q(r.status)}, ${r.amountCents}, ${date(addDays(today, r.dueOnDays))});`,
    );
  }
  for (const c of s4.charges) {
    sql(
      `insert into public.charges (id, member_id, chapter_id, fy, kind, description, amount_cents, due_on, waived_at) values (` +
        `${id('c', c.key)}, ${id('m', c.member)}, ${chapter(c.chapter)}, ${fyOf(today)}, ${q(c.kind)}, ` +
        `${c.kind === 'other' ? "'Fixture'" : 'null'}, ${c.amountCents}, ${date(addDays(today, c.dueOnDays))}, ` +
        `${c.waived ? "'2026-01-01T00:00:00Z'" : 'null'});`,
    );
  }
  for (const p of s4.payments) {
    sql(
      `insert into public.payments (id, charge_id, amount_cents, paid_on, method, state, receipt_no) values (` +
        `${id('pay', p.key)}, ${id('c', p.charge)}, ${p.amountCents}, ${date(today)}, 'payid', ${q(p.state)}, ` +
        `${p.receiptNo ? q(p.receiptNo) : 'null'});`,
    );
  }
}

const int = (n: number | null | undefined) => (n === null || n === undefined ? 'null' : String(n));
const textOrNull = (t: string | null | undefined) => (t === null || t === undefined ? 'null' : q(t));

const stage4Call = (c: ParityCase & Record<string, any>): string | null => {
  const v = c.votes ?? {};
  switch (c.action) {
    case 'openCheckin':
      return `public.open_checkin(${q(c.kind)}, ${c.ride ? id('r', c.ride) : 'null'}, ${chapter(c.chapter)}, ${q(c.title)}, ${date(c.heldOn)})`;
    case 'checkIn':
      return `public.check_in(${q(c.code)})`;
    case 'markAttendance':
      return `public.mark_attendance(${id('s', c.session)}, ${id('m', c.member)}, ${c.present})`;
    case 'closeCheckin':
      return `public.close_checkin(${id('s', c.session)})`;
    case 'decideApplication':
      return `public.decide_application(${id('m', c.member)}, ${c.status ? q(c.status) : 'null'}, ${int(v.for)}, ${int(v.against)}, ${int(v.abstained)}, ${textOrNull(c.note)})`;
    case 'fngReview':
      return `public.record_fng_review(${id('m', c.member)}, ${c.atMonths}, ${q(c.outcome)}, ${int(v.for)}, ${int(v.against)}, ${int(v.abstained)}, ${textOrNull(c.note)})`;
    case 'setFeeRate':
      return `public.set_fee_rate(${chapter(c.chapter)}, ${c.fy}, ${q(c.status)}, ${c.amountCents}, ${date(c.dueOn)})`;
    case 'setContinuationFee':
      return `public.set_continuation_fee(${chapter(c.chapter)}, ${c.fy}, ${c.amountCents})`;
    case 'setPaymentDetails':
      return `public.set_payment_details(${chapter(c.chapter)}, ${textOrNull(c.payid)}, null, null, null)`;
    case 'raiseFees':
      return `public.raise_fees(${chapter(c.chapter)}, ${c.fy})`;
    case 'raiseCharge':
      return `public.raise_charge(${id('m', c.member)}, ${q(c.description)}, ${c.amountCents}, ${date(c.dueOn)})`;
    case 'waiveCharge':
      return `public.waive_charge(${id('c', c.charge)})`;
    case 'claimPayment':
    case 'recordPayment':
      return (
        `public.${c.action === 'claimPayment' ? 'claim_payment' : 'record_payment'}(${id('c', c.charge)}, ${c.amountCents}, ` +
        `${date(c.paidOn)}, ${q(c.method)}, ${textOrNull(c.reference)})`
      );
    case 'confirmPayment':
      return `public.confirm_payment(${id('pay', c.payment)})`;
    case 'rejectPayment':
      return `public.reject_payment(${id('pay', c.payment)})`;
    default:
      return null;
  }
};

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
// A text[] literal, each line quoted by q(): array['a', 'b']::text[] (array[]::text[] when empty).
const textArray = (lines: unknown[]) => `array[${lines.map(q).join(', ')}]::text[]`;
const orNull = (s: string) => (s === '' ? 'null' : q(s));
// The briefing version a case was made on, as the app sends it (null: none).
const seen = (s: unknown) => (s === null || s === undefined ? 'null::timestamptz' : `${q(s)}::timestamptz`);
for (const b of fx.briefings ?? []) {
  sql(
    `insert into public.ride_briefings (ride_id, hazards, changes, notes, updated_at) values (` +
      `${id('r', b.ride)}, ${textArray(b.hazards)}, ${orNull(b.changes)}, ${orNull(b.notes)}, ${q(BRIEFED_AT)}::timestamptz);`,
  );
}
for (const r of fx.briefingReads ?? []) {
  sql(
    `insert into public.ride_briefing_reads (ride_id, member_id, read_at) values (` +
      `${id('r', r.ride)}, ${id('m', r.member)}, ${q(BRIEFED_AT)}::timestamptz);`,
  );
}
for (const v of fx.roadRules ?? []) {
  sql(
    `insert into public.road_rules_versions (number, body, changes, fresh, published_at) values (` +
      `${v.number}, ${q(v.body)}, ${orNull(v.changes)}, ${v.fresh}, ${q(RULES_AT)}::timestamptz);`,
  );
}
for (const s of fx.roadRulesSignoffs ?? []) {
  sql(
    `insert into public.road_rules_signoffs (member_id, version, signed_at) values (` +
      `${id('m', s.member)}, ${s.version}, ${q(RULES_AT)}::timestamptz);`,
  );
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
  const stage4 = stage4Call(resolveCase(c, today) as ParityCase & Record<string, any>);
  if (stage4) return stage4;
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
    case 'saveBriefing':
      // The texts as typed, untrimmed: the database must clean them the same way the app does.
      return (
        `public.save_briefing(${id('r', c.ride)}, ${textArray(c.hazards)}, ${text(c.changes, c.repeat)}, ` +
        `${text(c.notes, c.repeat)}, ${seen(c.seen)})`
      );
    case 'readBriefing':
      return `public.read_briefing(${id('r', c.ride)}, ${seen(c.seen)})`;
    case 'publishRoadRules':
      // The texts and the switch as typed: the database must clean them the same way the app does.
      return (
        `public.publish_road_rules(${text(c.body, c.repeat)}, ${text(c.changes, c.repeat)}, ${c.fresh}, ${c.seen})`
      );
    case 'signRoadRules':
      return `public.sign_road_rules(${c.version})`;
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
  if (c.noRoadRules) {
    // Nothing published yet, for this case only (rolled back with it).
    sql('delete from public.road_rules_signoffs;');
    sql('delete from public.road_rules_versions;');
  }
  sql(`select set_config('parity.chat', coalesce(${c.chat ? chatId(String(c.chat)) : 'null'}::text, ''), true);`);
  // No one signed in (as: null): an empty claim, so auth.uid() is null.
  sql(`select set_config('request.jwt.claim.sub', ${c.as === null ? "''" : `${id('m', c.as)}::text`}, true);`);
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
