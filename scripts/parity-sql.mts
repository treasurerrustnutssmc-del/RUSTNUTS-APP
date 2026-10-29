// Turns the shared who-can-do-what cases (supabase/tests/parity.json) into SQL that runs each
// case against the real database rules, expecting exactly the demo's answer: allowed, or refused
// with the demo's own message. Used by scripts/test-db.sh (via tsx); prints SQL to stdout.

// Stage 4
import { createHash } from 'node:crypto';
import { addDays } from '../src/domain/dates';
import { clubYearOf } from '../src/domain/clubYear';
import { fyOf } from '../src/domain/fees';
import { readGpx } from '../src/domain/gpx';
import { monthReport } from '../src/domain/ledger'; // Stage 5B
import { meetingFigures } from '../src/domain/meetingReport';
import {
  LEDGER_AT, BUDGET_AT, monthFrom, fixtureData, // Stage 5B
  BRIEFED_AT, BUS_AT, busKeyAt, PLANNED_AT, BUS_DECLINE_REASON, caseAction, fixtureSignedAt, RULES_AT, demoAnswer, fixture as fx, fixtureGpx, fngStart, parityToday,
  resolveCase, type ParityCase,
} from '../src/data/parityFixture.testkit';
import { DOCS_AT } from '../src/data/parityFixture.testkit'; // Stage 5C
import { ADMIN_AT, ADMIN_PLAN } from '../src/data/parityFixture.testkit'; // Stage 5D
import { CASE_PLAN } from '../src/data/adminActions'; // Stage 5D

const q = (s: unknown) => `'${String(s).replace(/'/g, "''")}'`;
const id = (kind: string, key: string) => `md5(${q(`${kind}:${key}`)})::uuid`;
// The same uuid as id(), worked out here, for text that has to hold it (a storage path).
const uuidOf = (kind: string, key: string) =>
  createHash('md5').update(`${kind}:${key}`).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
// A swap-and-sell photo's path: in the member's own folder, or `other:<name>` in someone else's.
const listingPhotoPath = (member: string | null, name: string) =>
  name.startsWith('other:') ? `${uuidOf('m', 'someone-else')}/${name.slice(6)}` : `${member ? uuidOf('m', member) : 'nobody'}/${name}`;
const chapter = (slug: string | null) => (slug === null ? 'null' : `(select id from public.chapters where slug = ${q(slug)})`);
const date = (d: string | null) => (d === null ? 'null' : `date ${q(d)}`);

const out: string[] = [];
const sql = (s: string) => out.push(s);
// A file in a storage bucket, uploaded by a member (nobody signed in uploads nothing).
const upload = (bucket: string, member: string | null, path: string) => {
  if (!member) return;
  sql(
    `insert into storage.objects (bucket_id, name, owner, owner_id) select ${q(bucket)}, ${q(path)}, ${id('m', member)}, ${id('m', member)}::text ` +
      `where not exists (select 1 from storage.objects where bucket_id = ${q(bucket)} and name = ${q(path)});`,
  );
};
const uploadSwap = (member: string | null, path: string) => upload('swap-media', member, path);

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
    `insert into public.bikes (id, member_id, make, model, year, is_project) values (` +
      `${id('b', b.key)}, ${id('m', b.member)}, ${q(b.make)}, ${q(b.model)}, ${b.year}, ${(b as { project?: boolean }).project ?? false});`,
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
    `insert into public.votes (id, chapter_id, question, electorate, threshold, quorum, opened_at, closes_at, closed_at, result) values (` +
      `${id('v', v.key)}, ${chapter(v.chapter)}, ${q(v.key)}, ${q(v.electorate)}, ${q(v.threshold)}, ${v.quorum}, ` +
      `'2025-12-01T00:00:00Z', ${q(v.closesAt)}::timestamptz, ` +
      `${v.result ? "'2026-01-01T00:00:00Z'" : 'null'}, ${v.result ? q(v.result) : 'null'});`,
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
        `${chapter(r.chapter)}, ${clubYearOf(today) + r.fyOffset}, ${q(r.status)}, ${r.amountCents}, ${date(addDays(today, r.dueOnDays))});`,
    );
  }
  for (const c of s4.charges) {
    sql(
      `insert into public.charges (id, member_id, chapter_id, fy, kind, description, amount_cents, due_on, waived_at) values (` +
        `${id('c', c.key)}, ${id('m', c.member)}, ${chapter(c.chapter)}, ${clubYearOf(today)}, ${q(c.kind)}, ` +
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
    case 'recordAgm':
      return `public.record_agm(${date(c.heldOn)})`;
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
    case 'designateBig4':
      return `public.designate_big4(${id('r', c.ride)}, ${chapter(c.chapter)})`;
    case 'undesignateBig4':
      return `public.undesignate_big4(${id('r', c.ride)})`;
    case 'setMeetingType':
      return `public.set_meeting_type(${id('s', c.session)}, ${q(c.type)})`;
    case 'setExemption':
      return `public.set_exemption(${id('s', c.session)}, ${id('m', c.member)}, ${textOrNull(c.reason)})`;
    // Big 4 RSVP rules and the 5.5 notice
    case 'setBig4Waiver':
      return `public.set_big4_waiver(${id('r', c.ride)}, ${id('m', c.member)}, ${textOrNull(c.ground)})`;
    case 'giveNotice':
      return `public.give_status_notice(${id('m', c.member)}, ${q(c.about)}, ${q(c.record)}, ${q(c.proposal)}, ${date(c.respondBy)})`;
    case 'respondNotice':
      return `public.respond_to_notice(${id('n', c.notice)}, ${q(c.response)})`;
    case 'closeNotice':
      return `public.close_status_notice(${id('n', c.notice)}, ${q(c.outcome)}, ${q(c.note)})`;
    default:
      return null;
  }
};

// Big 4 RSVP rules and the 5.5 notice
const b4 = fx.big4Rsvp;
if (b4) {
  for (const r of b4.big4Rides) {
    sql(`insert into public.big4_rides (ride_id, chapter_id) values (${id('r', r.ride)}, ${chapter(r.chapter)});`);
  }
  for (const w of b4.waivers) {
    sql(`insert into public.big4_waivers (ride_id, member_id, ground) values (${id('r', w.ride)}, ${id('m', w.member)}, ${q(w.ground)});`);
  }
  for (const n of b4.notices) {
    sql(
      `insert into public.status_notices (id, member_id, chapter_id, about, record, proposal, given_on, respond_by, outcome, closed_on) ` +
        `select ${id('n', n.key)}, m.id, m.chapter_id, ${q(n.about)}, ${q(n.key)}, ${q(n.key)}, ${date(addDays(today, n.givenDays))}, ` +
        `${date(addDays(today, n.respondByDays))}, ${textOrNull(n.outcome)}, ${n.outcome ? date(addDays(today, n.givenDays)) : 'null'} ` +
        `from public.members m where m.id = ${id('m', n.member)};`,
    );
  }
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
// A case's voice note (uploaded into the case's chat folder before the call), or nothing.
const voicePath = `${caseChat}::text || '/parity-voice.m4a'`;
const voiceNote = (durationMs: number | null | undefined) =>
  durationMs === undefined ? `'[]'::jsonb` : `jsonb_build_array(jsonb_build_object('kind', 'voice', 'path', ${voicePath}, 'durationMs', ${durationMs ?? 'null'}))`;
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
      `${id('m', s.member)}, ${s.version}, ${q(fixtureSignedAt(s, today))}::timestamptz);`,
  );
}

// The Rusty Bus, with days counted from today. Inserted as the owner, so the exclusion
// constraint still applies: the fixture's Booked bookings never share a day.
for (const b of fx.busBookings ?? []) {
  const decided = b.status === 'approved' || b.status === 'declined';
  sql(
    `insert into public.bus_bookings (id, first_day, last_day, purpose, ride_id, driver_id, status, booked_by, booked_at, ` +
      `decided_at, decline_reason, cancelled_at) values (` +
      `${id('bus', b.key)}, ${date(addDays(today, b.firstDays))}, ${date(addDays(today, b.lastDays))}, ${q(b.purpose)}, ` +
      `${b.ride ? id('r', b.ride) : 'null'}, ${b.driver ? id('m', b.driver) : 'null'}, ${q(b.status)}, ` +
      `${b.bookedBy ? id('m', b.bookedBy) : 'null'}, ${q(BUS_AT)}::timestamptz, ${decided ? `${q(BUS_AT)}::timestamptz` : 'null'}, ` +
      `${b.status === 'declined' ? q(BUS_DECLINE_REASON) : 'null'}, ${b.status === 'cancelled' ? `${q(BUS_AT)}::timestamptz` : 'null'});`,
  );
}

// Rusty Bus extras: handovers a minute apart, readings and costs on days counted from today.
(fx.busKeys ?? []).forEach((k, i) => {
  sql(`insert into public.bus_key_handovers (id, to_id, logged_at) values (${id('buskeys', k.key)}, ${id('m', k.to)}, ${q(busKeyAt(i))}::timestamptz);`);
});
for (const r of fx.busKm ?? []) {
  sql(
    `insert into public.bus_km (id, km, read_on, logged_by, logged_at, struck_at) values (${id('buskm', r.key)}, ${r.km}, ` +
      `${date(addDays(today, r.onDays))}, ${id('m', r.loggedBy)}, ${q(BUS_AT)}::timestamptz, ${r.struck ? `${q(BUS_AT)}::timestamptz` : 'null'});`,
  );
}
for (const c of fx.busCosts ?? []) {
  sql(
    `insert into public.bus_costs (id, spent_on, kind, amount_cents, litres, logged_by, logged_at, struck_at) values (` +
      `${id('buscost', c.key)}, ${date(addDays(today, c.onDays))}, ${q(c.kind)}, ${c.cents}, ${c.litres ?? 'null'}, ` +
      `${id('m', c.loggedBy)}, ${q(BUS_AT)}::timestamptz, ${c.struck ? `${q(BUS_AT)}::timestamptz` : 'null'});`,
  );
}

/** A Rusty Bus extras call, its days counted from today and its texts as typed (the database trims them). */
const busExtrasCall = (raw: ParityCase & Record<string, any>): string | null => {
  const c = resolveCase(raw, today) as ParityCase & Record<string, any>;
  const member = (key: string | null) => (key ? id('m', key) : 'null::uuid');
  const booking = (key: string | null) => (key ? id('bus', key) : 'null::uuid');
  switch (c.action) {
    case 'changeBus':
      return (
        `public.change_bus(${id('bus', c.booking)}, ${date(c.first ?? null)}, ${date(c.last ?? null)}, ` +
        `${c.purpose ? `${q(c.purpose)}::public.bus_purpose` : 'null::public.bus_purpose'}, ` +
        `${c.ride ? id('r', c.ride) : 'null::uuid'}, ${member(c.driver)}, ${text(c.notes, c.repeat)})`
      );
    case 'handBusKeys':
      return `public.hand_bus_keys(${member(c.to)}, ${text(c.note, c.repeat)})`;
    case 'logBusKm':
      return `public.log_bus_km(${c.km}, ${date(c.on ?? null)}, ${booking(c.booking)}, ${text(c.note)})`;
    case 'logBusCost':
      return (
        `public.log_bus_cost(${date(c.on ?? null)}, ${c.kind ? `${q(c.kind)}::public.bus_cost_kind` : 'null::public.bus_cost_kind'}, ` +
        `${c.cents}, ${c.litres ?? 'null'}::numeric, ${booking(c.booking)}, ${text(c.note)})`
      );
    case 'strikeBusKm':
      return `public.strike_bus_km(${id('buskm', c.entry)})`;
    case 'strikeBusCost':
      return `public.strike_bus_cost(${id('buscost', c.entry)})`;
    default:
      return null;
  }
};

/** A Rusty Bus call, its days counted from today and its texts as typed (the database trims them). */
const busCall = (raw: ParityCase & Record<string, any>): string => {
  const c = resolveCase(raw, today) as ParityCase & Record<string, any>;
  switch (c.action) {
    case 'bookBus':
      return (
        `public.book_bus(${date(c.first ?? null)}, ${date(c.last ?? null)}, ` +
        `${c.purpose ? `${q(c.purpose)}::public.bus_purpose` : 'null::public.bus_purpose'}, ` +
        `${c.ride ? id('r', c.ride) : 'null::uuid'}, ${c.driver ? id('m', c.driver) : 'null::uuid'}, ${text(c.notes, c.repeat)})`
      );
    case 'decideBus':
      return `public.decide_bus(${id('bus', c.booking)}, ${c.yes}, ${text(c.reason, c.repeat)})`;
    default:
      return `public.cancel_bus(${id('bus', c.booking)})`;
  }
};

/** A document library call, its dates resolved and its texts as typed (the database trims them). */
const documentCall = (c: ParityCase & Record<string, any>): string => {
  const approval = `${textOrNull(c.approvingBody)}, ${date(c.approved ?? null)}, ${date(c.commences ?? null)}`;
  switch (c.action) {
    case 'createDocument':
      return `public.create_document(${chapter(c.chapter)}, ${q(c.kind)}, ${text(c.title, c.titleRepeat)}, ${c.asksSignOff}, ${c.reviewMonths ?? 'null'})`;
    case 'publishDocumentVersion':
      return (
        `public.publish_document_version(${id('doc', c.document)}, ${c.expected}, ${text(c.label, c.labelRepeat)}, ` +
        `${text(c.body, c.bodyRepeat)}, ${text(c.whatChanged, c.changesRepeat)}, ${c.fresh}, ${approval})`
      );
    case 'recordDocumentApproval':
      return `public.record_document_approval(${id('dv', c.version)}, ${approval})`;
    case 'markDocumentReviewed':
      return `public.mark_document_reviewed(${id('doc', c.document)})`;
    default:
      return `public.sign_document(${id('dv', c.version)})`;
  }
};

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

const ledgerCall = (c: ParityCase & Record<string, any>): string => {
  switch (c.action) {
    case 'recordCredit':
      return `public.record_credit(${chapter(c.chapter)}, ${q(c.code)}, ${q(c.description)}, ${c.amountCents}, ${date(c.receivedOn ?? null)}, ${date(c.entryOn ?? null)})`;
    case 'recordDebit':
      return (
        `public.record_debit(${chapter(c.chapter)}, ${q(c.code)}, ${q(c.description)}, ${c.amountCents}, ` +
        `${c.payee ? id('m', c.payee) : 'null'}, ${textOrNull(c.payeeName)}, ${date(c.paidOn ?? null)})`
      );
    case 'approveDebit':
      return `public.approve_debit(${id('le', c.entry)})`;
    case 'payDebit':
      return `public.pay_debit(${id('le', c.entry)}, ${date(c.paidOn ?? null)})`;
    case 'voidEntry':
      return `public.void_entry(${id('le', c.entry)}, ${q(c.reason)})`;
    case 'addFeePayment':
      return `public.add_fee_payment(${id('pay', c.payment)})`;
    case 'setOpening':
      return `public.set_opening(${chapter(c.chapter)}, ${c.fy}, ${c.amountCents})`;
    case 'setCashFloat':
      return `public.set_cash_float(${c.fy}, ${c.amountCents})`;
    case 'saveBudget':
      return `public.save_budget(${chapter(c.chapter)}, ${c.fy}, ${json(c.lines)})`;
    case 'approveBudget':
      return `public.approve_budget(${chapter(c.chapter)}, ${c.fy}, ${id('v', c.vote)})`;
    case 'reopenBudget':
      return `public.reopen_budget(${chapter(c.chapter)}, ${c.fy})`;
    case 'saveMeetingReport':
      return `public.save_meeting_report(null, ${date(c.from ?? null)}, ${date(c.to ?? null)}, ${q(c.notes ?? '')})`;
    default:
      return `public.present_report(${date(c.month)})`;
  }
};

// Stage 5D: conduct records, merch, contributions and new chapters. Dates come as …Days from today.
const ADMIN_CASE_ACTIONS = new Set([
  'recordConduct', 'holdConduct', 'removeConduct', 'lodgeAppeal', 'setHearing', 'decideAppeal', 'withdrawAppeal',
  'proposeMerch', 'decideMerch', 'closeMerch', 'orderMerch', 'decideOrder', 'payOrder', 'handOver', 'cancelOrder',
  'proposeContribution', 'decideContribution', 'withdrawContribution', 'proposeChapter', 'settleChapter', 'withdrawChapter',
]);
const uuids = (keys: string[], kind = 'm') => (keys.length ? `array[${keys.map((k) => id(kind, k)).join(', ')}]::uuid[]` : `'{}'::uuid[]`);
const texts = (xs: string[]) => (xs.length ? `array[${xs.map(q).join(', ')}]::text[]` : `'{}'::text[]`);
const maybeDate = (d: string | null | undefined) => date(d ?? null);
const adminCall = (c: ParityCase & Record<string, any>): string => {
  switch (c.action) {
    case 'recordConduct':
      return (
        `public.record_conduct(${id('m', c.member)}, ${c.kind ? q(c.kind) : 'null'}, ${q(c.summary)}, ${q(c.rule ?? '')}, ` +
        `${maybeDate(c.decided)}, ${maybeDate(c.notice)}, ${maybeDate(c.suspended)})`
      );
    case 'holdConduct':
      return `public.hold_conduct(${id('cr', c.record)}, ${maybeDate(c.until)}, ${q(c.reason)})`;
    case 'removeConduct':
      return `public.remove_conduct(${id('cr', c.record)})`;
    case 'lodgeAppeal':
      return `public.lodge_conduct_appeal(${id('cr', c.record)}, ${q(c.grounds)})`;
    case 'setHearing':
      return `public.set_conduct_hearing(${id('cr', c.record)}, ${uuids(c.panel)}, ${maybeDate(c.hearing)})`;
    case 'decideAppeal':
      return `public.decide_conduct_appeal(${id('cr', c.record)}, ${q(c.outcome)}, ${q(c.note)})`;
    case 'withdrawAppeal':
      return `public.withdraw_conduct_appeal(${id('cr', c.record)})`;
    case 'proposeMerch':
      return (
        `public.propose_merch(${chapter(c.chapter)}, ${q(c.itemName)}, ${q(c.details ?? '')}, ${texts(c.sizes)}, ` +
        `${c.priceCents}, ${c.patchedOnly ? 'true' : 'false'})`
      );
    case 'decideMerch':
      return `public.decide_merch(${id('mi', c.item)}, ${c.yes}, ${q(c.reason ?? '')})`;
    case 'closeMerch':
      return `public.close_merch(${id('mi', c.item)})`;
    case 'orderMerch':
      return `public.order_merch(${id('mi', c.item)}, ${c.size === null ? 'null' : q(c.size)}, ${c.qty}, ${q(c.note ?? '')})`;
    case 'decideOrder':
      return `public.decide_merch_order(${id('mo', c.order)}, ${c.yes}, ${q(c.reason ?? '')})`;
    case 'payOrder':
      return `public.pay_merch_order(${id('mo', c.order)}, ${maybeDate(c.paid)})`;
    case 'handOver':
      return `public.hand_over_merch_order(${id('mo', c.order)})`;
    case 'cancelOrder':
      return `public.cancel_merch_order(${id('mo', c.order)})`;
    case 'proposeContribution':
      return `public.propose_contribution(${q(c.title)}, ${q(c.purpose)}, ${c.totalCents})`;
    case 'decideContribution':
      return `public.decide_contribution(${id('nc', c.contribution)}, ${chapter(c.chapter)}, ${id('v', c.vote)})`;
    case 'withdrawContribution':
      return `public.withdraw_contribution(${id('nc', c.contribution)})`;
    case 'proposeChapter': {
      const plan = { ...CASE_PLAN, ...(c.plan ?? {}) };
      return (
        `public.propose_chapter(${q(c.chapterName)}, ${q(c.area)}, ${q(c.state ?? 'VIC')}, ${q(plan.location)}, ${q(plan.membership)}, ` +
        `${q(plan.leadership)}, ${q(plan.budget)}, ${q(plan.operations)}, ${uuids(c.founders)}, ${id('m', c.president)}, ${id('m', c.saa)})`
      );
    }
    case 'settleChapter':
      return `public.settle_chapter_proposal(${id('cp', c.proposal)}, ${id('v', c.vote)})`;
    case 'withdrawChapter':
      return `public.withdraw_chapter_proposal(${id('cp', c.proposal)})`;
    default:
      throw new Error(`Unknown action ${c.action} in "${c.name}"`);
  }
};

// The National Auditor: requests, reports and renewal. Dates come as …Days from today.
const auditCall = (c: ParityCase & Record<string, any>): string | null => {
  switch (c.action) {
    case 'raiseAuditRequest':
      return `public.raise_audit_request(${chapter(c.chapter)}, ${q(c.kind)}, ${q(c.area)}, ${q(c.title)}, ${q(c.details)}, ${maybeDate(c.due)}, null)`;
    case 'saveAuditReport':
      return `public.save_audit_report(null, ${q(c.title)}, ${maybeDate(c.from)}, ${maybeDate(c.to)}, ${q(c.findings)}, ${c.recommendations ? q(c.recommendations) : 'null'})`;
    case 'renewAuditor':
      return 'public.renew_auditor()';
    default:
      return null;
  }
};

const call = (c: ParityCase & Record<string, any>): string => {
  if (ADMIN_CASE_ACTIONS.has(String(c.action))) return adminCall(resolveCase(c, today) as ParityCase & Record<string, any>);
  const audit = auditCall(resolveCase(c, today) as ParityCase & Record<string, any>);
  if (audit) return audit;
  const stage4 = stage4Call(resolveCase(c, today) as ParityCase & Record<string, any>);
  if (stage4) return stage4;
  const planning = planningCall(c);
  if (planning) return planning;
  const busExtras = busExtrasCall(c);
  if (busExtras) return busExtras;
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
    case 'bookBus':
    case 'decideBus':
    case 'cancelBus':
      return busCall(c);
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
    case 'shareMinutes':
      return `public.share_minutes(${id('mt', c.meeting)})`;
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
    // Stage 5B: the treasurer's books. Dates come as …Days from today.
    case 'recordCredit':
    case 'recordDebit':
    case 'approveDebit':
    case 'payDebit':
    case 'voidEntry':
    case 'addFeePayment':
    case 'setOpening':
    case 'setCashFloat':
    case 'saveBudget':
    case 'approveBudget':
    case 'reopenBudget':
    case 'presentReport':
    case 'saveMeetingReport':
      return ledgerCall(resolveCase(c, today) as ParityCase & Record<string, any>);
    // Stage 5C: the document library. Dates come as …Days from today.
    case 'createDocument':
    case 'publishDocumentVersion':
    case 'recordDocumentApproval':
    case 'markDocumentReviewed':
    case 'signDocument':
      return documentCall(resolveCase(c, today) as ParityCase & Record<string, any>);
    case 'chatSend':
      return `public.send_message(${caseChat}, ${text(c.body, c.repeat)}, ${voiceNote(c.voice)} || ${gifs(c.gifs)}, ${c.replyTo ? id('msg', c.replyTo) : 'null'})`;
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
    // Stage 7: social extras
    case 'socialSetBirthday':
      return `public.set_birthday(${c.month ?? 'null'}, ${c.day ?? 'null'})`;
    case 'socialSetSkills':
      return `public.set_skills(array[${(c.skills as string[]).map(q).join(', ')}]::text[])`;
    case 'socialSaveMechanic':
      return (
        `public.save_mechanic(${c.mechanic ? id('mech', c.mechanic) : 'null'}, ${text(c.workshop, c.repeat)}, ${q(c.suburb)}, ` +
        `${q(c.phone)}, ${q(c.website)}, ${q(c.speciality)}, ${q(c.notes)})`
      );
    case 'socialArchiveMechanic':
      return `public.archive_mechanic(${id('mech', c.mechanic)})`;
    case 'socialVouchMechanic':
      return `public.vouch_mechanic(${id('mech', c.mechanic)}, ${c.on})`;
    case 'socialSaveListing':
      return (
        `public.save_listing(${c.listing ? id('listing', c.listing) : 'null'}, ${q(c.kind)}, ${q(c.title)}, ` +
        `${c.price ?? 'null'}, ${q(c.details)}, ${json((c.photos as string[]).map((n) => ({ path: listingPhotoPath(c.as, n), width: 800, height: 600 })))})`
      );
    case 'socialMarkListingSold':
      return `public.mark_listing_sold(${id('listing', c.listing)}, ${c.sold})`;
    case 'socialTakeDownListing':
      return `public.take_down_listing(${id('listing', c.listing)})`;
    case 'socialPostBuildUpdate':
      return (
        `public.post_build_update(${id('b', c.bike)}, ${q(c.body)}, ` +
        `${json((c.photos as string[]).map((n) => ({ path: listingPhotoPath(c.as, n), width: 800, height: 600 })))})`
      );
    case 'socialTakeDownBuildUpdate':
      return `public.take_down_build_update(${id('build', c.update)})`;
    case 'socialSaveHistoryEntry':
      return (
        `public.save_history_entry(${c.entry ? id('history', c.entry) : 'null'}, ${q(c.happenedOn)}, ${q(c.precision)}, ` +
        `${q(c.title)}, ${q(c.story)})`
      );
    case 'socialArchiveHistoryEntry':
      return `public.archive_history_entry(${id('history', c.entry)})`;
    case 'socialSaveHonour':
      return (
        `public.save_honour(${c.honour ? id('honour', c.honour) : 'null'}, ${c.member ? id('m', c.member) : 'null'}, ` +
        `${q(c.who)}, ${q(c.title)}, ${c.year ?? 'null'}, ${q(c.note)})`
      );
    case 'socialArchiveHonour':
      return `public.archive_honour(${id('honour', c.honour)})`;
    case 'socialOpenAward':
      return (
        `public.open_award(${q(c.kind)}, ${q(c.title)}, ${c.year ?? 'null'}, ${q(addDays(today, c.nominationsCloseDays))}, ` +
        `${q(addDays(today, c.votingCloseDays))})`
      );
    case 'socialArchiveAward':
      return `public.archive_award(${id('award', c.award)})`;
    case 'socialNominate':
      return (
        `public.nominate(${id('award', c.award)}, ${c.ride ? id('r', c.ride) : 'null'}, ${q(c.title)}, ` +
        `${c.photo ? `${json({ path: listingPhotoPath(c.as, c.photo), width: 800, height: 600 })}` : 'null'}, ${q(c.story)}, ${q(c.reason)})`
      );
    case 'socialWithdrawNomination':
      return `public.withdraw_nomination(${id('nom', c.nomination)})`;
    case 'socialCastBragVote':
      return `public.cast_brag_vote(${id('nom', c.nomination)})`;
    // Invites to and from other clubs
    case 'socialSaveOtherClub':
      return (
        `public.save_other_club(${c.otherClub ? id('oc', c.otherClub) : 'null'}, ${q(c.club)}, ${q(c.town)}, ${q(c.contact)}, ` +
        `${q(c.note)})`
      );
    case 'socialArchiveOtherClub':
      return `public.archive_other_club(${id('oc', c.otherClub)})`;
    case 'socialSaveInviteIn': {
      const r = resolveCase(c, today) as ParityCase & Record<string, any>; // eventOnDays: days from today
      return (
        `public.save_invite_in(${r.invite ? id('inv', r.invite) : 'null'}, ${id('oc', r.otherClub)}, ${chapter(r.chapter)}, ` +
        `${q(r.title)}, ${q(r.eventOn)}, ${q(r.place)}, ${q(r.details)}, ${r.ride ? id('r', r.ride) : 'null'})`
      );
    }
    case 'socialInviteClub':
      return `public.invite_club(${id('r', c.ride)}, ${id('oc', c.otherClub)}, ${q(c.note)})`;
    case 'socialAnswerInvite':
      return (
        `public.answer_invite(${id('inv', c.invite)}, ${q(c.answer)}, ${c.label === null ? 'null' : q(c.label)}, ` +
        `${c.bikes ?? 'null'}, ${q(c.note)})`
      );
    case 'socialArchiveInvite':
      return `public.archive_invite(${id('inv', c.invite)})`;
    default:
      throw new Error(`Unknown action ${c.action} in "${c.name}"`);
  }
};

// Ride planning extras, inserted as the owner.
const planned = `${q(PLANNED_AT)}::timestamptz`;
for (const r of fx.bikeRanges ?? []) sql(`update public.bikes set range_km = ${r.rangeKm} where id = ${id('b', r.bike)};`);
for (const p of fx.ridePlans ?? []) {
  sql(`insert into public.ride_plans (ride_id, stops, updated_at) values (${id('r', p.ride)}, ${json(p.stops)}, ${planned});`);
}
for (const r of fx.routeRatings ?? []) {
  sql(`insert into public.route_ratings (route_id, member_id, stars, rated_at) values (${id('rt', r.route)}, ${id('m', r.member)}, ${r.stars}, ${planned});`);
}
for (const c of fx.rideCalls ?? []) {
  sql(`insert into public.ride_calls (ride_id, state, reason, called_at) values (${id('r', c.ride)}, ${q(c.state)}, ${c.reason ? q(c.reason) : 'null'}, ${planned});`);
}
for (const h of fx.rideHubs ?? []) {
  sql(`insert into public.ride_hubs (ride_id, members_only, beds, updated_at) values (${id('r', h.ride)}, ${h.membersOnly}, ${h.beds ?? 'null'}, ${planned});`);
}
for (const r of fx.hubRegistrations ?? []) {
  sql(
    `insert into public.hub_registrations (ride_id, member_id, staying, pillion, registered_at) values (` +
      `${id('r', r.ride)}, ${id('m', r.member)}, ${q(r.staying)}, ${r.pillion}, ${planned});`,
  );
}
for (const w of fx.crewSwaps ?? []) {
  sql(
    `insert into public.crew_swaps (id, ride_id, asked_by, role, asked_to, their_role, state, asked_at, answered_at) values (` +
      `${id('sw', w.key)}, ${id('r', w.ride)}, ${id('m', w.askedBy)}, ${q(w.role)}, ${id('m', w.askedTo)}, ` +
      `${w.theirRole ? q(w.theirRole) : 'null'}, ${q(w.state)}, ${planned}, ${w.state === 'asked' ? 'null' : planned});`,
  );
}

// Charity ride sign-ups, inserted as the owner.
for (const c of fx.charityRides ?? []) {
  sql(
    `insert into public.charity_rides (ride_id, cause, places, jobs, updated_at) values (` +
      `${id('r', c.ride)}, ${q(c.cause)}, ${c.places ?? 'null'}, ${textArray(c.jobs)}, ${planned});`,
  );
}
for (const s of fx.charitySignups ?? []) {
  sql(
    `insert into public.charity_signups (ride_id, member_id, riding, pillion, guests, job, signed_at) values (` +
      `${id('r', s.ride)}, ${id('m', s.member)}, ${s.riding}, ${s.pillion}, ${s.guests}, ${s.job === null ? 'null' : q(s.job)}, ${planned});`,
  );
}

/** A ride planning extras call, its texts as typed (the database trims them). */
const planningCall = (c: ParityCase & Record<string, any>): string | null => {
  switch (c.action) {
    case 'setBikeRange':
      return `public.set_bike_range(${id('b', c.bike)}, ${c.rangeKm ?? 'null'})`;
    case 'saveRidePlan': {
      const stops = c.repeatStops ? Array.from({ length: c.repeatStops }, () => c.stops[0]) : c.stops;
      return `public.save_ride_plan(${id('r', c.ride)}, ${json(stops)}, ${seen(c.seen)})`;
    }
    case 'rateRoute':
      return `public.rate_route(${id('rt', c.route)}, ${c.stars}, ${text(c.comment, c.repeat)})`;
    case 'callRide':
      return `public.call_ride(${id('r', c.ride)}, ${q(c.state)}, ${text(c.reason, c.repeat)}, ${date(c.newDay ?? null)})`;
    case 'saveHub':
      return (
        `public.save_hub(${id('r', c.ride)}, ${c.membersOnly}, ${date(c.closesOn ?? null)}, ${c.beds ?? 'null'}, ` +
        `${q(c.accommodation)}, ${q(c.notes)})`
      );
    case 'registerHub':
      return `public.register_hub(${id('r', c.ride)}, ${q(c.staying)}, ${c.pillion}, ${q(c.shareWith)}, ${q(c.notes)})`;
    case 'withdrawHub':
      return `public.withdraw_hub(${id('r', c.ride)})`;
    case 'askSwap':
      return `public.ask_swap(${id('r', c.ride)}, ${id('m', c.to)}, ${text(c.note, c.repeat)})`;
    case 'answerSwap':
      return `public.answer_swap(${id('sw', c.swap)}, ${c.yes})`;
    case 'withdrawSwap':
      return `public.withdraw_swap(${id('sw', c.swap)})`;
    // Charity ride sign-ups
    case 'saveCharity':
      return (
        `public.save_charity(${id('r', c.ride)}, ${q(c.cause)}, ${text(c.about, c.repeat)}, ${date(c.closesOn ?? null)}, ` +
        `${c.places ?? 'null'}, ${textArray(c.jobs)})`
      );
    case 'signUpCharity':
      return (
        `public.sign_up_charity(${id('r', c.ride)}, ${c.riding}, ${c.pillion}, ${c.guests}, ${q(c.guestNames)}, ` +
        `${c.job === null ? 'null' : q(c.job)}, ${text(c.notes, c.repeat)})`
      );
    case 'withdrawCharity':
      return `public.withdraw_charity(${id('r', c.ride)})`;
    default:
      return null;
  }
};

// Stage 5C: the document library, inserted as the owner.
for (const d of fx.documents ?? []) {
  sql(
    `insert into public.documents (id, chapter_id, kind, title, asks_sign_off, review_months, created_at) values (` +
      `${id('doc', d.key)}, ${chapter(d.chapter)}, ${q(d.kind)}, ${q(d.title)}, ${d.asksSignOff}, ${d.reviewMonths ?? 'null'}, ${q(DOCS_AT)}::timestamptz);`,
  );
}
const dayOrNull = (n: number | undefined) => (n === undefined ? 'null' : date(addDays(today, n)));
for (const v of fx.documentVersions ?? []) {
  sql(
    `insert into public.document_versions (id, document_id, number, label, body, fresh_sign_off, approving_body, approved_on, ` +
      `commences_on, published_at) values (${id('dv', v.key)}, ${id('doc', v.document)}, ${v.number}, ${q(v.label)}, ${q(v.body)}, ` +
      `${v.fresh}, ${textOrNull(v.approvingBody)}, ${dayOrNull(v.approvedDays)}, ${dayOrNull(v.commencesDays)}, ${q(DOCS_AT)}::timestamptz);`,
  );
}
for (const s of fx.documentSignoffs ?? []) {
  sql(`insert into public.document_signoffs (version_id, member_id, signed_at) values (${id('dv', s.version)}, ${id('m', s.member)}, ${q(DOCS_AT)}::timestamptz);`);
}

// Stage 5B: the treasurer's books, inserted as the owner.
for (const e of fx.ledger ?? []) {
  const credit = e.code.startsWith('CR');
  sql(
    `insert into public.ledger_entries (id, chapter_id, code, description, amount_cents, received_on, entry_on, payee_member_id, ` +
      `payee_name, payment_id, state, recorded_at, updated_at, void_reason) values (` +
      `${id('le', e.key)}, ${chapter(e.chapter)}, ${q(e.code)}, ${q(e.key)}, ${e.amountCents}, ${credit ? date(e.entryOn) : 'null'}, ` +
      `${date(e.entryOn)}, ${e.payee ? id('m', e.payee) : 'null'}, ${e.payee || credit ? 'null' : "'Payee'"}, ` +
      `${e.payment ? id('pay', e.payment) : 'null'}, ${q(e.state)}, ${q(LEDGER_AT)}::timestamptz, ${q(LEDGER_AT)}::timestamptz, ` +
      `${e.state === 'void' ? "'Fixture'" : 'null'});`,
  );
  for (const m of e.approvals ?? []) {
    sql(`insert into public.ledger_approvals (entry_id, member_id, approved_at) values (${id('le', e.key)}, ${id('m', m)}, ${q(LEDGER_AT)}::timestamptz);`);
  }
}
for (const o of fx.fundOpenings ?? []) {
  sql(`insert into public.fund_openings (chapter_id, fy, amount_cents) values (${chapter(o.chapter)}, ${o.fy}, ${o.amountCents});`);
}
for (const f of fx.cashFloats ?? []) {
  sql(`insert into public.cash_floats (fy, amount_cents) values (${f.fy}, ${f.amountCents});`);
}
for (const b of fx.budgets ?? []) {
  sql(
    `insert into public.budgets (chapter_id, fy, lines, approved_at, updated_at) values (${chapter(b.chapter)}, ${fyOf(today) + b.fyOffset}, ` +
      `${json(b.lines)}, ${b.approved ? `${q(LEDGER_AT)}::timestamptz` : 'null'}, ${q(b.changedAt ?? BUDGET_AT)}::timestamptz);`,
  );
}
for (const r of fx.treasurerReports ?? []) {
  sql(`insert into public.treasurer_reports (month, presented_at) values (${date(monthFrom(today, r.monthOffset))}, ${q(LEDGER_AT)}::timestamptz);`);
}
// The monthly report: the database works out the same numbers as the demo.
if (fx.reportMonth) {
  const r = monthReport(fx.reportMonth, fixtureData([], today));
  const funds = Object.entries(r.funds).map(([k, v]) => [k === 'club' ? null : k, v] as const);
  sql('do $report$ declare r jsonb := private.month_report(' + date(fx.reportMonth) + '); begin');
  const check = (expr: string, want: string, what: string) =>
    sql(`  if (${expr}) is distinct from ${want} then raise exception 'PARITY: the report''s ${what} differs: %', ${expr}; end if;`);
  check(`(r->>'opening_cents')::bigint`, String(r.openingCents), 'opening');
  check(`(r->>'credit_total')::bigint`, String(r.creditTotal), 'credit total');
  check(`(r->>'debit_total')::bigint`, String(r.debitTotal), 'debit total');
  check(`(r->>'total_cents')::bigint`, String(r.totalCents), 'total');
  check(`(r->>'float_cents')::bigint`, String(r.floatCents), 'float');
  check(`(r->>'bank_cents')::bigint`, String(r.bankCents), 'bank balance');
  check(`r->'credits'`, json(r.credits), 'credits by code');
  check(`r->'debits'`, json(r.debits), 'debits by code');
  for (const [slug, cents] of funds) {
    const key = slug === null ? q('club') : `(select id::text from public.chapters where slug = ${q(slug)})`;
    check(`(r->'funds'->>${key})::bigint`, String(cents), `${slug ?? 'Club'} fund`);
  }
  sql('end $report$;');
  sql(`\\echo '  The ${fx.reportMonth.slice(0, 7)} Treasurer''s Report adds up the same in the demo and the database'`);
}
// The Treasurer's Report for a meeting: the same figures for a period that cuts months short.
if (fx.reportPeriod) {
  const { from, to } = fx.reportPeriod;
  const f = meetingFigures(from, to, fixtureData([], today));
  sql('do $period$ declare r jsonb := private.meeting_report(' + date(from) + ', ' + date(to) + '); begin');
  const check = (expr: string, want: string, what: string) =>
    sql(`  if (${expr}) is distinct from ${want} then raise exception 'PARITY: the meeting report''s ${what} differs: %', ${expr}; end if;`);
  check(`(r->>'opening_cents')::bigint`, String(f.openingCents), 'opening');
  check(`(r->>'closing_cents')::bigint`, String(f.closingCents), 'closing');
  check(`(r->>'receipts_cents')::bigint`, String(f.receiptsCents), 'receipts');
  check(`(r->>'payments_cents')::bigint`, String(f.paymentsCents), 'payments');
  check(`(r->>'float_cents')::bigint`, String(f.floatCents), 'float');
  check(`(r->>'line_count')::bigint`, String(f.lineCount), 'line count');
  check(`r->'credits'`, json(f.credits), 'credits by code');
  check(`r->'debits'`, json(f.debits), 'debits by code');
  const months = f.months.map((m) => ({ month: m.month, from: m.from, to: m.to, receipts_cents: m.receiptsCents, payments_cents: m.paymentsCents }));
  check(`r->'months'`, json(months), 'months');
  for (const [k, m] of Object.entries(f.funds)) {
    const key = k === 'club' ? q('club') : `(select id::text from public.chapters where slug = ${q(k)})`;
    const want = { opening_cents: m.openingCents, receipts_cents: m.receiptsCents, payments_cents: m.paymentsCents, closing_cents: m.closingCents };
    check(`r->'funds'->${key}`, json(want), `${k} fund`);
  }
  sql('end $period$;');
  sql(`\\echo '  The Treasurer''s Report for ${from} to ${to} adds up the same in the demo and the database'`);
}

// Stage 7: social extras. The fixture's workshops, inserted as the owner.
for (const m of (fx as typeof fx & { mechanics?: { key: string; name: string; addedBy: string | null; archived: boolean }[] }).mechanics ?? []) {
  sql(
    `insert into public.mechanics (id, name, added_by, archived_at) values (${id('mech', m.key)}, ${q(m.name)}, ` +
      `${m.addedBy ? id('m', m.addedBy) : 'null'}, ${m.archived ? 'now()' : 'null'});`,
  );
}

// The fixture's build updates, with their photos uploaded by their posters.
type FixtureBuildUpdate = { key: string; bike: string; author: string; photos: string[]; takenDown: boolean };
for (const u of (fx as typeof fx & { buildUpdates?: FixtureBuildUpdate[] }).buildUpdates ?? []) {
  const photos = u.photos.map((n) => ({ path: listingPhotoPath(u.author, n), width: 800, height: 600 }));
  for (const p of photos) upload('build-media', u.author, p.path);
  sql(
    `insert into public.build_updates (id, bike_id, author_id, body, photos, taken_down_at) values (${id('build', u.key)}, ` +
      `${id('b', u.bike)}, ${id('m', u.author)}, 'Fixture update', ${json(photos)}, ${u.takenDown ? 'now()' : 'null'});`,
  );
}

// Invites to and from other clubs: every incoming invite is for 01/01/2030.
type FixtureOtherClub = { key: string; name: string; addedBy: string | null; archived: boolean };
for (const c of (fx as typeof fx & { otherClubs?: FixtureOtherClub[] }).otherClubs ?? []) {
  sql(
    `insert into public.other_clubs (id, name, added_by, archived_at) values (${id('oc', c.key)}, ${q(c.name)}, ` +
      `${c.addedBy ? id('m', c.addedBy) : 'null'}, ${c.archived ? 'now()' : 'null'});`,
  );
}
type FixtureInvite = {
  key: string; direction: string; club: string; chapter: string | null; ride: string | null; answer: string; label: string | null;
  addedBy: string | null; archived: boolean;
};
for (const i of (fx as typeof fx & { invites?: FixtureInvite[] }).invites ?? []) {
  const incoming = i.direction === 'in';
  sql(
    `insert into public.club_invites (id, direction, club_id, chapter_id, ride_id, title, event_on, answer, calendar_label, ` +
      `added_by, answered_by, answered_at, archived_at) values (${id('inv', i.key)}, ${q(i.direction)}, ${id('oc', i.club)}, ` +
      `${chapter(i.chapter)}, ${i.ride ? id('r', i.ride) : 'null'}, ${incoming ? "'Fixture event'" : 'null'}, ` +
      `${incoming ? "date '2030-01-01'" : 'null'}, ${q(i.answer)}, ${i.label ? q(i.label) : 'null'}, ${i.addedBy ? id('m', i.addedBy) : 'null'}, ` +
      `${i.answer === 'waiting' ? 'null, null' : `${id('m', 'rusty')}, now()`}, ${i.archived ? 'now()' : 'null'});`,
  );
}

// The fixture's timeline entries and honours, kept by Rusty.
type FixtureHistory = { key: string; title: string; archived: boolean };
for (const e of (fx as typeof fx & { history?: FixtureHistory[] }).history ?? []) {
  sql(
    `insert into public.club_history (id, happened_on, precision, title, added_by, archived_at) values (${id('history', e.key)}, ` +
      `'2019-05-11', 'day', ${q(e.title)}, ${id('m', 'rusty')}, ${e.archived ? 'now()' : 'null'});`,
  );
}
type FixtureHonour = { key: string; member: string | null; who: string | null; archived: boolean };
for (const h of (fx as typeof fx & { honours?: FixtureHonour[] }).honours ?? []) {
  sql(
    `insert into public.club_honours (id, member_id, name, honour, year, added_by, archived_at) values (${id('honour', h.key)}, ` +
      `${h.member ? id('m', h.member) : 'null'}, ${h.who === null ? 'null' : q(h.who)}, 'Life member', 2024, ${id('m', 'rusty')}, ` +
      `${h.archived ? 'now()' : 'null'});`,
  );
}

// The fixture's awards, their dates counted from today, and their nominations.
type FixtureAward = { key: string; kind: string; title: string; year: number; nominationsDays: number; votingDays: number; archived: boolean };
for (const a of (fx as typeof fx & { awards?: FixtureAward[] }).awards ?? []) {
  sql(
    `insert into public.brag_awards (id, kind, title, year, nominations_close, voting_close, opened_by, archived_at) values (` +
      `${id('award', a.key)}, ${q(a.kind)}, ${q(a.title)}, ${a.year}, ${date(addDays(today, a.nominationsDays))}, ` +
      `${date(addDays(today, a.votingDays))}, ${id('m', 'rusty')}, ${a.archived ? 'now()' : 'null'});`,
  );
}
type FixtureNomination = { key: string; award: string; by: string; ride: string | null; withdrawn: boolean };
for (const n of (fx as typeof fx & { nominations?: FixtureNomination[] }).nominations ?? []) {
  sql(
    `insert into public.brag_nominations (id, award_id, nominated_by, ride_id, title, story, withdrawn_at) values (${id('nom', n.key)}, ` +
      `${id('award', n.award)}, ${id('m', n.by)}, ${n.ride ? id('r', n.ride) : 'null'}, ${n.ride ? 'null' : "'Fixture'"}, ` +
      `${n.ride ? 'null' : "'Fixture'"}, ${n.withdrawn ? 'now()' : 'null'});`,
  );
}

for (const v of (fx as typeof fx & { bragVotes?: { award: string; member: string; nomination: string }[] }).bragVotes ?? []) {
  sql(
    `insert into public.brag_votes (award_id, member_id, nomination_id) values (${id('award', v.award)}, ${id('m', v.member)}, ` +
      `${id('nom', v.nomination)});`,
  );
}

// The fixture's listings, with their photos uploaded by their sellers.
type FixtureListing = { key: string; seller: string; kind: string; title: string; price: number | null; photos: string[]; takenDown: boolean };
for (const l of (fx as typeof fx & { listings?: FixtureListing[] }).listings ?? []) {
  const photos = l.photos.map((n) => ({ path: listingPhotoPath(l.seller, n), width: 800, height: 600 }));
  for (const p of photos) uploadSwap(l.seller, p.path);
  sql(
    `insert into public.listings (id, seller_id, kind, title, price_dollars, photos, taken_down_at) values (${id('listing', l.key)}, ` +
      `${id('m', l.seller)}, ${q(l.kind)}, ${q(l.title)}, ${l.price ?? 'null'}, ${json(photos)}, ${l.takenDown ? 'now()' : 'null'});`,
  );
}

// Stage 5D: conduct records, merch, contributions and chapter proposals, inserted as the owner.
const ad = fx.admin;
if (ad) {
  for (const r of ad.conduct) {
    sql(
      `insert into public.conduct_records (id, member_id, chapter_id, kind, summary, decided_on, notice_on, recorded_by, recorded_at) ` +
        `select ${id('cr', r.key)}, id, chapter_id, ${q(r.kind)}, ${q(r.key)}, ${date(addDays(today, r.decidedDays))}, ` +
        `${date(addDays(today, r.noticeDays))}, ${id('m', r.recordedBy)}, ${q(ADMIN_AT)}::timestamptz from public.members where id = ${id('m', r.member)};`,
    );
    if (r.appeal) {
      sql(
        `insert into public.conduct_appeals (record_id, lodged_on, lodged_by, grounds, panel, hearing_on) values (${id('cr', r.key)}, ` +
          `${date(addDays(today, r.appeal.lodgedDays))}, ${id('m', r.appeal.lodgedBy)}, 'Fixture', ${uuids(r.appeal.panel)}, ` +
          `${r.appeal.hearingDays === null ? 'null' : date(addDays(today, r.appeal.hearingDays))});`,
      );
    }
  }
  for (const i of ad.merchItems) {
    sql(
      `insert into public.merch_items (id, chapter_id, name, sizes, price_cents, patched_only, status, proposed_by, proposed_at, decided_at) values (` +
        `${id('mi', i.key)}, ${chapter(i.chapter)}, ${q(i.name)}, ${texts(i.sizes)}, ${i.priceCents}, ${i.patchedOnly}, ${q(i.status)}, ` +
        `${id('m', i.proposedBy)}, ${q(ADMIN_AT)}::timestamptz, ${i.status === 'proposed' ? 'null' : `${q(ADMIN_AT)}::timestamptz`});`,
    );
  }
  for (const o of ad.merchOrders) {
    sql(
      `insert into public.merch_orders (id, item_id, member_id, size, qty, unit_cents, status, ordered_at, decided_at, paid_on) values (` +
        `${id('mo', o.key)}, ${id('mi', o.item)}, ${id('m', o.member)}, ${o.size === null ? 'null' : q(o.size)}, ${o.qty}, ` +
        `${ad.merchItems.find((i) => i.key === o.item)!.priceCents}, ${q(o.status)}, ${q(ADMIN_AT)}::timestamptz, ` +
        `${o.status === 'waiting' ? 'null' : `${q(ADMIN_AT)}::timestamptz`}, ${o.status === 'paid' ? `private.club_date(${q(ADMIN_AT)}::timestamptz)` : 'null'});`,
    );
  }
  const demo = fixtureData([], today);
  for (const k of ad.contributions) {
    sql(
      `insert into public.national_contributions (id, title, purpose, total_cents, proposed_at, shares) values (` +
        `${id('nc', k.key)}, ${q(k.key)}, 'Fixture', ${k.totalCents}, ${q(ADMIN_AT)}::timestamptz, private.contribution_shares(${k.totalCents}));`,
    );
    for (const x of k.decided) {
      sql(
        `insert into public.contribution_decisions (contribution_id, chapter_id, yes, vote_id, recorded_at) values (` +
          `${id('nc', k.key)}, ${chapter(x.chapter)}, ${x.yes}, ${id('v', x.vote)}, ${q(ADMIN_AT)}::timestamptz);`,
      );
    }
    // The database shares it out the same as the demo, to the cent.
    const want = demo.contributions!.find((c) => c.id === k.key)!.shares;
    for (const s of want) {
      sql(
        `do $shares$ begin if (select (e->>'cents')::int from public.national_contributions k, jsonb_array_elements(k.shares) e ` +
          `where k.id = ${id('nc', k.key)} and e->>'chapter_id' = ${chapter(s.chapterId)}::text) is distinct from ${s.cents} then ` +
          `raise exception 'PARITY: ${k.key}''s ${s.chapterId} share differs from the demo''s ${s.cents} cents'; end if; end $shares$;`,
      );
    }
  }
  for (const p of ad.chapterProposals) {
    sql(
      `insert into public.chapter_proposals (id, name, area, state, plan, founder_ids, president_id, saa_id, proposed_by, proposed_at) values (` +
        `${id('cp', p.key)}, ${q(p.name)}, 'Fixture', 'VIC', ${json(ADMIN_PLAN)}, ${uuids(p.founders)}, ${id('m', p.president)}, ` +
        `${id('m', p.saa)}, ${id('m', p.proposedBy)}, ${q(ADMIN_AT)}::timestamptz);`,
    );
  }
}

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
  // A listing's photos are uploaded first (by their owner), as the phone does.
  if (c.action === 'socialSaveListing') {
    for (const n of c.photos as string[]) uploadSwap(n.startsWith('other:') ? 'someone-else' : c.as, listingPhotoPath(c.as, n));
  }
  if (c.action === 'socialNominate' && c.photo) {
    upload('brag-media', String(c.photo).startsWith('other:') ? 'someone-else' : c.as, listingPhotoPath(c.as, String(c.photo)));
  }
  if (c.action === 'chatSend' && c.voice !== undefined && c.as) {
    sql(
      `insert into storage.objects (bucket_id, name, owner, owner_id) select 'chat-media', ${voicePath}, ${id('m', c.as)}, ${id('m', c.as)}::text;`,
    );
  }
  if (c.action === 'socialPostBuildUpdate') {
    for (const n of c.photos as string[]) upload('build-media', n.startsWith('other:') ? 'someone-else' : c.as, listingPhotoPath(c.as, n));
  }
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
