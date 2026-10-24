// Turns the shared who-can-do-what cases (supabase/tests/parity.json) into SQL that runs each
// case against the real database rules, expecting exactly the demo's answer: allowed, or refused
// with the demo's own message. Used by scripts/test-db.sh (via tsx); prints SQL to stdout.

import { demoAnswer, fixture as fx, type ParityCase } from '../src/data/parityFixture.testkit';
// Stage 4
import { addDays } from '../src/domain/dates';
import { fyOf } from '../src/domain/fees';
import { fngStart, parityToday, resolveCase } from '../src/data/parityFixture.testkit';

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
const text = (t: string | null | undefined) => (t === null || t === undefined ? 'null' : q(t));

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
      return `public.decide_application(${id('m', c.member)}, ${c.status ? q(c.status) : 'null'}, ${int(v.for)}, ${int(v.against)}, ${int(v.abstained)}, ${text(c.note)})`;
    case 'fngReview':
      return `public.record_fng_review(${id('m', c.member)}, ${c.atMonths}, ${q(c.outcome)}, ${int(v.for)}, ${int(v.against)}, ${int(v.abstained)}, ${text(c.note)})`;
    case 'setFeeRate':
      return `public.set_fee_rate(${chapter(c.chapter)}, ${c.fy}, ${q(c.status)}, ${c.amountCents}, ${date(c.dueOn)})`;
    case 'setContinuationFee':
      return `public.set_continuation_fee(${chapter(c.chapter)}, ${c.fy}, ${c.amountCents})`;
    case 'setPaymentDetails':
      return `public.set_payment_details(${chapter(c.chapter)}, ${text(c.payid)}, null, null, null)`;
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
        `${date(c.paidOn)}, ${q(c.method)}, ${text(c.reference)})`
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
