// Turns the club's roster sheet (saved as CSV) into SQL an admin runs once to load the claimable
// roster. Loading sends nothing to anyone: members are only linked when they sign in themselves.
// Used by scripts/roster-sql.mts.

import { parseAuDate } from '../domain/dates';
import { ROLE_LABEL, STATUS_LABEL } from '../domain/labels';
import type { MemberStatus, PositionRole } from '../domain/types';

export type RosterRow = {
  email: string;
  chapter: string;
  fullName: string;
  roadName: string | null;
  status: MemberStatus;
  joinedOn: string | null;
  patchedOn: string | null;
  fngStartedOn: string | null;
  onHiatus: boolean;
  roles: PositionRole[];
};

const COLUMNS = ['email', 'chapter', 'full_name', 'road_name', 'status', 'joined_on', 'patched_on', 'fng_started_on', 'on_hiatus', 'roles'] as const;
const CHAPTERS = ['west', 'north'];
const NATIONAL: PositionRole[] = ['nec_chair', 'nec_secretary', 'nec_auditor', 'founder'];
// Seats only one person can hold at a time (the database enforces the same).
const ONE_HOLDER: PositionRole[] = [...NATIONAL, 'president', 'vice_president', 'secretary', 'treasurer', 'sergeant_at_arms', 'road_captain'];

/** Splits one CSV line, honouring "quoted, fields" and "" escapes. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

export function parseRosterCsv(csv: string): RosterRow[] {
  // Quoted line breaks aren't supported; the roster sheet has none.
  const lines = csv.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
  const header = splitCsvLine(lines[0] ?? '').map((h) => h.toLowerCase());
  const missing = COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(', ')}`);
  const col = (cells: string[], name: (typeof COLUMNS)[number]) => cells[header.indexOf(name)] ?? '';

  const seen = new Set<string>();
  const seats = new Set<string>();
  const rows: RosterRow[] = [];
  lines.slice(1).forEach((line, index) => {
    if (!line.trim()) return;
    const where = `Line ${index + 2}`;
    const cells = splitCsvLine(line);
    if (cells.length !== header.length) {
      throw new Error(`${where}: has ${cells.length} cells but the sheet has ${header.length} columns`);
    }
    const date = (name: 'joined_on' | 'patched_on' | 'fng_started_on') => {
      const raw = col(cells, name);
      if (!raw) return null;
      const iso = parseAuDate(raw);
      if (!iso) throw new Error(`${where}: ${name} "${raw}" isn't a real DD/MM/YYYY date`);
      return iso;
    };

    const email = col(cells, 'email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`${where}: email "${email}" doesn't look right`);
    if (seen.has(email)) throw new Error(`${where}: ${email} is on the sheet twice`);
    seen.add(email);

    const chapter = col(cells, 'chapter').toLowerCase();
    if (!CHAPTERS.includes(chapter)) throw new Error(`${where}: chapter "${chapter}" should be ${CHAPTERS.join(' or ')}`);

    const fullName = col(cells, 'full_name');
    if (!fullName) throw new Error(`${where}: full_name is empty`);

    const status = col(cells, 'status').toLowerCase() as MemberStatus;
    if (!Object.hasOwn(STATUS_LABEL, status)) throw new Error(`${where}: status "${status}" should be one of ${Object.keys(STATUS_LABEL).join(', ')}`);

    const roles = col(cells, 'roles')
      .split(';')
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean) as PositionRole[];
    const badRole = roles.find((r) => !Object.hasOwn(ROLE_LABEL, r));
    if (badRole) throw new Error(`${where}: role "${badRole}" should be one of ${Object.keys(ROLE_LABEL).join(', ')}`);

    for (const role of roles.filter((r) => ONE_HOLDER.includes(r))) {
      const seat = `${role} of ${NATIONAL.includes(role) ? 'the club' : chapter}`;
      if (seats.has(seat)) throw new Error(`${where}: ${seat} is on the sheet twice, but only one person can hold it`);
      seats.add(seat);
    }

    const hiatus = col(cells, 'on_hiatus').toLowerCase();
    if (hiatus && !/^(y|yes|true|1|n|no|false|0)$/.test(hiatus)) {
      throw new Error(`${where}: on_hiatus "${hiatus}" should be yes or no`);
    }

    rows.push({
      email,
      chapter,
      fullName,
      roadName: col(cells, 'road_name') || null,
      status,
      joinedOn: date('joined_on'),
      patchedOn: date('patched_on'),
      fngStartedOn: date('fng_started_on'),
      onHiatus: /^(y|yes|true|1)$/.test(hiatus),
      roles,
    });
  });
  if (!rows.length) throw new Error('The sheet has no members on it');
  return rows;
}

const q = (s: string | null) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`);
const d = (s: string | null) => (s === null ? 'null' : `date ${q(s)}`);

/** SQL that adds or refreshes each roster row. Rows someone has already claimed are left alone. */
export function rosterSql(rows: RosterRow[]): string {
  const values = rows.map(
    (r) =>
      `  (${q(r.email)}, (select id from public.chapters where slug = ${q(r.chapter)}), ${q(r.fullName)}, ${q(r.roadName)}, ` +
      `${q(r.status)}::public.member_status, ${d(r.joinedOn)}, ${d(r.patchedOn)}, ${d(r.fngStartedOn)}, ${r.onHiatus}, ` +
      `${q(`{${r.roles.join(',')}}`)}::public.position_role[])`,
  );
  return [
    '-- Loads the claimable roster. Sends nothing; each member is linked when they first sign in.',
    'insert into private.roster (email, chapter_id, full_name, road_name, status, joined_on, patched_on, fng_started_on, on_hiatus, roles)',
    'values',
    values.join(',\n'),
    'on conflict (lower(trim(email))) do update set',
    '  chapter_id = excluded.chapter_id, full_name = excluded.full_name, road_name = excluded.road_name,',
    '  status = excluded.status, joined_on = excluded.joined_on, patched_on = excluded.patched_on,',
    '  fng_started_on = excluded.fng_started_on, on_hiatus = excluded.on_hiatus, roles = excluded.roles',
    'where private.roster.claimed_by is null;',
    '',
  ].join('\n');
}
