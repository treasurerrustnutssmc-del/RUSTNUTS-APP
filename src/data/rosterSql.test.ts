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
