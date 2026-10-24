// Prints the SQL that loads the claimable roster from the club's roster sheet saved as CSV.
//   npx tsx scripts/roster-sql.mts roster.csv > roster.sql
// Columns: email, chapter (west/north), full_name, road_name, status, joined_on, patched_on,
// fng_started_on (DD/MM/YYYY), on_hiatus (yes/no), roles (semicolon-separated, e.g. president;tail_gunner).
// Never commit the CSV or the SQL: they hold real member details.

import { readFileSync } from 'node:fs';
import { parseRosterCsv, rosterSql } from '../src/data/rosterSql';

const file = process.argv[2];
if (!file) throw new Error('Usage: npx tsx scripts/roster-sql.mts roster.csv');
process.stdout.write(rosterSql(parseRosterCsv(readFileSync(file, 'utf8'))));
