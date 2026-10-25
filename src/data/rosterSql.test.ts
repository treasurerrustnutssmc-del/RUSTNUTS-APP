import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRosterCsv, rosterSql } from './rosterSql';

const HEADER = 'email,chapter,full_name,road_name,status,joined_on,patched_on,fng_started_on,on_hiatus,roles';

test('reads the roster sheet: DD/MM/YYYY dates, roles split on semicolons, quoted commas', () => {
  const rows = parseRosterCsv(
    `${HEADER}\n` +
      ` RockHard@Example.com ,West,"Hardy, Rocky",RockHard,full,01/03/2019,01/09/2019,,no,president\n` +
      `ftw@example.com,north,Fred Twig,,fng,15/01/2026,,15/01/2026,,\n` +
      `abz@example.com,west,Abz,Abz,full,,,,yes,ride_committee;tail_gunner\n`,
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    email: 'rockhard@example.com', chapter: 'west', fullName: 'Hardy, Rocky', roadName: 'RockHard', status: 'full',
    joinedOn: '2019-03-01', patchedOn: '2019-09-01', fngStartedOn: null, onHiatus: false, roles: ['president'],
    details: { phone: null, emergency: null, bike: null },
  });
  assert.equal(rows[1].roadName, null);
  assert.equal(rows[1].fngStartedOn, '2026-01-15');
  assert.deepEqual(rows[2].roles, ['ride_committee', 'tail_gunner']);
  assert.equal(rows[2].onHiatus, true);
});

test('a member who left in good standing loads as Legacy', () => {
  const rows = parseRosterCsv(`${HEADER}\nhacker@example.com,west,Justin Borg,Hacker,legacy,,,,,\n`);
  assert.equal(rows[0].status, 'legacy');
});

test('an Excel "CSV UTF-8" file (with a byte-order mark) reads the same', () => {
  const rows = parseRosterCsv(`\uFEFF${HEADER}\r\na@b.com,west,A,,full,,,,,\r\n`);
  assert.equal(rows[0].email, 'a@b.com');
});

test('refuses a sheet with mistakes, naming the line', () => {
  assert.throws(() => parseRosterCsv(`${HEADER}\nnot-an-email,west,A,,full,,,,,\n`), /line 2.*email/i);
  assert.throws(() => parseRosterCsv(`${HEADER}\na@b.com,south,A,,full,,,,,\n`), /line 2.*chapter/i);
  assert.throws(() => parseRosterCsv(`${HEADER}\na@b.com,west,A,,boss,,,,,\n`), /line 2.*status/i);
  assert.throws(() => parseRosterCsv(`${HEADER}\na@b.com,west,A,,full,31/02/2019,,,,\n`), /line 2.*joined_on/i);
  assert.throws(() => parseRosterCsv(`${HEADER}\na@b.com,west,A,,full,,,,,king\n`), /line 2.*role/i);
  assert.throws(() => parseRosterCsv(`${HEADER}\na@b.com,west,A,,full,,,,,\nA@B.com,north,B,,full,,,,,\n`), /line 3.*twice/i);
  assert.throws(() => parseRosterCsv('email,chapter\n'), /missing column/i);
  assert.throws(() => parseRosterCsv(`${HEADER}\na@b.com,west,A,,constructor,,,,,\n`), /line 2.*status/i);
  assert.throws(() => parseRosterCsv(`${HEADER}\na@b.com,west,A,,full,,,,,__proto__\n`), /line 2.*role/i);
  assert.throws(() => parseRosterCsv(`${HEADER}\na@b.com,west,A,,full,,,,maybe,\n`), /line 2.*on_hiatus/i);
  assert.throws(() => parseRosterCsv(`${HEADER}\na@b.com,west,A,,full\n`), /line 2.*10 columns/i);
  assert.throws(() => parseRosterCsv(`${HEADER}\n`), /no members/i);
  assert.throws(() => parseRosterCsv(`${HEADER}\na@b.com,west,A,,legacy,,,,,president\n`), /line 2.*legacy.*position/i);
  assert.throws(() => parseRosterCsv(`${HEADER}\na@b.com,west,A,,legacy,,,,yes,\n`), /line 2.*legacy.*hiatus/i);
  assert.doesNotThrow(() => parseRosterCsv(`${HEADER}\na@b.com,west,A,,legacy,,,,,founder\n`), 'Founder is an honour that stays');
  assert.throws(
    () => parseRosterCsv(`${HEADER}\na@b.com,west,A,,full,,,,,president\nc@d.com,west,C,,full,,,,,president\n`),
    /line 3.*president.*west.*twice/i,
  );
});

test('makes SQL that loads the roster without sending anything and leaves claimed rows alone', () => {
  const sql = rosterSql(parseRosterCsv(`${HEADER}\no'brien@example.com,west,Pat O'Brien,Paddy,full,,,,,president;tail_gunner\n`));
  assert.match(sql, /insert into private\.roster/);
  assert.match(sql, /'o''brien@example\.com'/);
  assert.match(sql, /'Pat O''Brien'/);
  assert.match(sql, /'\{president,tail_gunner\}'::public\.position_role\[\]/);
  assert.match(sql, /on conflict \(lower\(trim\(email\)\)\) do update/);
  assert.match(sql, /where private\.roster\.claimed_by is null/);
  const statements = sql.split('\n').filter((l) => !l.startsWith('--')).join('\n');
  assert.doesNotMatch(statements, /auth\.|invite|send/i, 'touches the roster table only');
});

const DETAILS = `${HEADER},phone,emergency_name,emergency_relationship,emergency_phone,bike_make,bike_model,bike_rego`;

test('reads phone, emergency contact and bike when the sheet has them', () => {
  const rows = parseRosterCsv(
    `${DETAILS}\n` +
      `a@b.com,west,Al B,,full,,,,,,0400 111 222,Cat B,Partner,0400 333 444,Harley-Davidson,Low Rider,1AB-2CD\n` +
      `c@d.com,west,Cy D,,fng,,,,,,,,,,,,\n` +
      `e@f.com,west,Ed F,,full,,,,,,,Fay F,,0400 555 666,,,\n`,
  );
  assert.deepEqual(rows[0].details, {
    phone: '0400 111 222',
    emergency: { name: 'Cat B', relationship: 'Partner', phone: '0400 333 444' },
    bike: { make: 'Harley-Davidson', model: 'Low Rider', rego: '1AB-2CD' },
  });
  assert.deepEqual(rows[1].details, { phone: null, emergency: null, bike: null });
  assert.deepEqual(rows[2].details.emergency, { name: 'Fay F', relationship: null, phone: '0400 555 666' });
  assert.equal(rows[2].details.bike, null);
});

test('a sheet without the detail columns still loads', () => {
  const rows = parseRosterCsv(`${HEADER}\na@b.com,west,A,,full,,,,,\n`);
  assert.deepEqual(rows[0].details, { phone: null, emergency: null, bike: null });
});

test('refuses half an emergency contact or half a bike', () => {
  assert.throws(() => parseRosterCsv(`${DETAILS}\na@b.com,west,A,,full,,,,,,,Cat,,,,,\n`), /line 2.*emergency/i);
  assert.throws(() => parseRosterCsv(`${DETAILS}\na@b.com,west,A,,full,,,,,,,,,0400 1,,,\n`), /line 2.*emergency/i);
  assert.throws(() => parseRosterCsv(`${DETAILS}\na@b.com,west,A,,full,,,,,,,,,,,Low Rider,\n`), /line 2.*bike_make/i);
  assert.throws(() => parseRosterCsv(`${DETAILS}\na@b.com,west,A,,full,,,,,,,,,,,,1AB\n`), /line 2.*bike_make/i);
  assert.throws(() => parseRosterCsv(`${DETAILS}\na@b.com,west,A,,full,,,,,,,,,,Honda,,\n`), /line 2.*bike_model/i);
  assert.throws(() => parseRosterCsv(`${DETAILS}\na@b.com,west,A,,full,,,,,,,,Wife,,,,\n`), /line 2.*emergency/i);
});

test('the SQL carries the details, and refreshes them on unclaimed rows', () => {
  const sql = rosterSql(
    parseRosterCsv(`${DETAILS}\na@b.com,west,Al B,,full,,,,,,0400 111 222,Cat O'Hara,,0400 333 444,Honda,CMX,\n`),
  );
  assert.match(sql, /phone, emergency_name, emergency_relationship, emergency_phone, bike_make, bike_model, bike_rego\)/);
  assert.match(sql, /'0400 111 222', 'Cat O''Hara', null, '0400 333 444', 'Honda', 'CMX', null\)/);
  assert.match(sql, /emergency_name = excluded\.emergency_name/);
  assert.match(sql, /bike_rego = excluded\.bike_rego/);
});
