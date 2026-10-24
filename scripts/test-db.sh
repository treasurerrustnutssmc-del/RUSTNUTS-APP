#!/usr/bin/env bash
# Spins up a throwaway Postgres, applies the migrations and runs the access checks.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")"
WORK="$(mktemp -d)"
PORT=54329
trap '"$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

run_pg() {
  if [ "$(id -u)" = "0" ]; then
    chown -R postgres "$WORK"
    su postgres -s /bin/bash -c "$*"
  else
    bash -c "$*"
  fi
}

run_pg "'$PGBIN/initdb' -D '$WORK/data' -A trust -U postgres >/dev/null"
run_pg "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses=' -l '$WORK/log' start -w >/dev/null"

PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -c "create database rustnuts" >/dev/null
"${PSQL[@]}" -d rustnuts -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$f")"
  "${PSQL[@]}" -d rustnuts -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts -f "$ROOT/supabase/tests/access_rules_test.sql"

# The shared demo-vs-database cases, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_parity" >/dev/null
"${PSQL[@]}" -d rustnuts_parity -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_parity -f "$f" >/dev/null
done
(cd "$ROOT" && npx tsx scripts/parity-sql.mts) | "${PSQL[@]}" -d rustnuts_parity

# The founder seed, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_seed" >/dev/null
"${PSQL[@]}" -d rustnuts_seed -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_seed -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_seed -f "$ROOT/supabase/tests/founder_seed_test.sql"

# The claimable roster, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_roster" >/dev/null
"${PSQL[@]}" -d rustnuts_roster -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_roster -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_roster -f "$ROOT/supabase/tests/roster_claim_test.sql"
# The loader script's SQL runs against the real schema, twice (the second run refreshes, not duplicates).
for _ in 1 2; do
  (cd "$ROOT" && npx tsx scripts/roster-sql.mts supabase/tests/roster_sample.csv) | "${PSQL[@]}" -d rustnuts_roster >/dev/null
done
"${PSQL[@]}" -d rustnuts_roster -tAc "select count(*) from private.roster where email = 'sample@example.com' and on_hiatus and status = 'nomad' and roles = '{ride_committee,tail_gunner}'" | grep -qx 1
echo 'The roster loader script loads the sheet and can be re-run'
# The ride calendar, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_rides" >/dev/null
"${PSQL[@]}" -d rustnuts_rides -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_rides -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_rides -f "$ROOT/supabase/tests/rides_test.sql"
# The ride crew, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_crew" >/dev/null
"${PSQL[@]}" -d rustnuts_crew -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_crew -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_crew -f "$ROOT/supabase/tests/ride_crew_test.sql"

# Lane E: live ride, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_live" >/dev/null
"${PSQL[@]}" -d rustnuts_live -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_live -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_live -f "$ROOT/supabase/tests/live_ride_test.sql"

echo 'ALL DATABASE CHECKS PASSED'
