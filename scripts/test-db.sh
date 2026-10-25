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
# Ride routes, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_routes" >/dev/null
"${PSQL[@]}" -d rustnuts_routes -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_routes -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_routes -f "$ROOT/supabase/tests/ride_routes_test.sql"
# Ride briefings, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_briefings" >/dev/null
"${PSQL[@]}" -d rustnuts_briefings -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_briefings -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_briefings -f "$ROOT/supabase/tests/ride_briefings_test.sql"
# Road Rules, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_road_rules" >/dev/null
"${PSQL[@]}" -d rustnuts_road_rules -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_road_rules -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_road_rules -f "$ROOT/supabase/tests/road_rules_test.sql"
# The Going gate (Road Rules on set_rsvp and set_crew), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_going_gate" >/dev/null
"${PSQL[@]}" -d rustnuts_going_gate -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_going_gate -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_going_gate -f "$ROOT/supabase/tests/going_gate_test.sql"
# The Rusty Bus, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_bus" >/dev/null
"${PSQL[@]}" -d rustnuts_bus -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_bus -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_bus -f "$ROOT/supabase/tests/rusty_bus_test.sql"

# Stage 5: meetings and votes, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_business" >/dev/null
"${PSQL[@]}" -d rustnuts_business -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_business -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_business -f "$ROOT/supabase/tests/meetings_votes_test.sql"
# Lane E: live ride, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_live" >/dev/null
"${PSQL[@]}" -d rustnuts_live -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_live -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_live -f "$ROOT/supabase/tests/live_ride_test.sql"

# Stage 4: check-ins, decisions and fees, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_money" >/dev/null
"${PSQL[@]}" -d rustnuts_money -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_money -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_money -f "$ROOT/supabase/tests/members_money_test.sql"
# Lane E: notification settings, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_notify" >/dev/null
"${PSQL[@]}" -d rustnuts_notify -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_notify -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_notify -f "$ROOT/supabase/tests/notification_prefs_test.sql"

# Stage 3 (lane B): the chats, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_chat" >/dev/null
"${PSQL[@]}" -d rustnuts_chat -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_chat -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_chat -f "$ROOT/supabase/tests/chat_test.sql"

# Lane E: push outbox, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_push" >/dev/null
"${PSQL[@]}" -d rustnuts_push -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_push -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_push -f "$ROOT/supabase/tests/push_test.sql"

# Lane E: ride comms, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_voice" >/dev/null
"${PSQL[@]}" -d rustnuts_voice -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_voice -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_voice -f "$ROOT/supabase/tests/ride_voice_test.sql"

# Constitution v4: positions, status, FNG reviews, the continuation fee and meeting notice.
"${PSQL[@]}" -c "create database rustnuts_v4" >/dev/null
"${PSQL[@]}" -d rustnuts_v4 -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_v4 -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_v4 -f "$ROOT/supabase/tests/constitution_v4_test.sql"

echo 'ALL DATABASE CHECKS PASSED'
