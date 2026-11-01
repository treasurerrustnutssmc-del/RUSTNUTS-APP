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
"${PSQL[@]}" -d rustnuts -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts -f "$ROOT/supabase/tests/access_rules_test.sql"

# The shared demo-vs-database cases, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_parity" >/dev/null
"${PSQL[@]}" -d rustnuts_parity -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_parity -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_parity -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
(cd "$ROOT" && npx tsx scripts/parity-sql.mts) | "${PSQL[@]}" -d rustnuts_parity

# The founder seed, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_seed" >/dev/null
"${PSQL[@]}" -d rustnuts_seed -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_seed -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_seed -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_seed -f "$ROOT/supabase/tests/founder_seed_test.sql"

# The claimable roster, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_roster" >/dev/null
"${PSQL[@]}" -d rustnuts_roster -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_roster -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_roster -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
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
"${PSQL[@]}" -d rustnuts_rides -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_rides -f "$ROOT/supabase/tests/rides_test.sql"
# The ride crew, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_crew" >/dev/null
"${PSQL[@]}" -d rustnuts_crew -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_crew -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_crew -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_crew -f "$ROOT/supabase/tests/ride_crew_test.sql"
# Ride routes, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_routes" >/dev/null
"${PSQL[@]}" -d rustnuts_routes -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_routes -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_routes -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_routes -f "$ROOT/supabase/tests/ride_routes_test.sql"
# Ride briefings, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_briefings" >/dev/null
"${PSQL[@]}" -d rustnuts_briefings -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_briefings -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_briefings -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_briefings -f "$ROOT/supabase/tests/ride_briefings_test.sql"
# Road Rules, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_road_rules" >/dev/null
"${PSQL[@]}" -d rustnuts_road_rules -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_road_rules -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_road_rules -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_road_rules -f "$ROOT/supabase/tests/road_rules_test.sql"
# The Going gate (Road Rules on set_rsvp and set_crew), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_going_gate" >/dev/null
"${PSQL[@]}" -d rustnuts_going_gate -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_going_gate -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_going_gate -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_going_gate -f "$ROOT/supabase/tests/going_gate_test.sql"
# The Going gate pasted before the Road Rules: it must refuse and change nothing.
"${PSQL[@]}" -c "create database rustnuts_gate_order" >/dev/null
"${PSQL[@]}" -d rustnuts_gate_order -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  [[ "$(basename "$f")" < "20261024160000" ]] || continue
  "${PSQL[@]}" -d rustnuts_gate_order -f "$f" >/dev/null 2>&1
done
"${PSQL[@]}" -d rustnuts_gate_order -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
if out="$("${PSQL[@]}" -d rustnuts_gate_order -f "$ROOT/supabase/migrations/20261025180000_going_needs_road_rules.sql" 2>&1)"; then
  echo "The Going gate migration applied without the Road Rules"; exit 1
fi
echo "$out" | grep -q 'Paste road-rules.sql first.' || { echo "Wrong refusal: $out"; exit 1; }
"${PSQL[@]}" -d rustnuts_gate_order -tAc "select count(*) from pg_proc where proname in ('set_rsvp', 'set_crew') and prosrc like '%road_rules%'" | grep -qx 0 \
  || { echo "The Going gate changed set_rsvp or set_crew without the Road Rules"; exit 1; }
echo 'The Going gate migration refuses to go in before the Road Rules, and changes nothing'
# The Rusty Bus, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_bus" >/dev/null
"${PSQL[@]}" -d rustnuts_bus -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_bus -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_bus -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_bus -f "$ROOT/supabase/tests/rusty_bus_test.sql"

# Stage 5: meetings and votes, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_business" >/dev/null
"${PSQL[@]}" -d rustnuts_business -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_business -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_business -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_business -f "$ROOT/supabase/tests/meetings_votes_test.sql"
# Lane E: live ride, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_live" >/dev/null
"${PSQL[@]}" -d rustnuts_live -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_live -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_live -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_live -f "$ROOT/supabase/tests/live_ride_test.sql"

# Stage 4: check-ins, decisions and fees, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_money" >/dev/null
"${PSQL[@]}" -d rustnuts_money -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_money -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_money -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_money -f "$ROOT/supabase/tests/members_money_test.sql"
# Lane E: notification settings, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_notify" >/dev/null
"${PSQL[@]}" -d rustnuts_notify -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_notify -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_notify -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_notify -f "$ROOT/supabase/tests/notification_prefs_test.sql"

# Stage 3 (lane B): the chats, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_chat" >/dev/null
"${PSQL[@]}" -d rustnuts_chat -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_chat -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_chat -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_chat -f "$ROOT/supabase/tests/chat_test.sql"

# Lane E: push outbox, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_push" >/dev/null
"${PSQL[@]}" -d rustnuts_push -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_push -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_push -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_push -f "$ROOT/supabase/tests/push_test.sql"

# Chat notifications, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_chat_push" >/dev/null
"${PSQL[@]}" -d rustnuts_chat_push -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_chat_push -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_chat_push -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_chat_push -f "$ROOT/supabase/tests/chat_push_test.sql"

# Lane E: ride comms, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_voice" >/dev/null
"${PSQL[@]}" -d rustnuts_voice -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_voice -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_voice -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_voice -f "$ROOT/supabase/tests/ride_voice_test.sql"

# Constitution v4: positions, status, FNG reviews, the continuation fee and meeting notice.
"${PSQL[@]}" -c "create database rustnuts_v4" >/dev/null
"${PSQL[@]}" -d rustnuts_v4 -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_v4 -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_v4 -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_v4 -f "$ROOT/supabase/tests/constitution_v4_test.sql"

# Stage 5B: the treasurer's books, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_treasurer" >/dev/null
"${PSQL[@]}" -d rustnuts_treasurer -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_treasurer -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_treasurer -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_treasurer -f "$ROOT/supabase/tests/treasurer_test.sql"

# The Treasurer's Report for a meeting, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_meeting_reports" >/dev/null
"${PSQL[@]}" -d rustnuts_meeting_reports -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_meeting_reports -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_meeting_reports -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_meeting_reports -f "$ROOT/supabase/tests/meeting_reports_test.sql"

# Stage 5D: conduct records, merch, national contributions and new chapters, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_board_admin" >/dev/null
"${PSQL[@]}" -d rustnuts_board_admin -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_board_admin -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_board_admin -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_board_admin -f "$ROOT/supabase/tests/board_admin_test.sql"

# Stage 7: the social extras, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_social" >/dev/null
"${PSQL[@]}" -d rustnuts_social -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_social -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_social -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_social -f "$ROOT/supabase/tests/social_test.sql"

# Stage 5C: the document library, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_documents" >/dev/null
"${PSQL[@]}" -d rustnuts_documents -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_documents -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_documents -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_documents -f "$ROOT/supabase/tests/documents_test.sql"

# Attendance rules and Big 4 rides, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_attendance" >/dev/null
"${PSQL[@]}" -d rustnuts_attendance -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_attendance -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_attendance -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_attendance -f "$ROOT/supabase/tests/attendance_rules_test.sql"

# Ride planning extras: bike range, plans, ratings, calls, hubs and swaps, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_planning" >/dev/null
"${PSQL[@]}" -d rustnuts_planning -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_planning -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_planning -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_planning -f "$ROOT/supabase/tests/ride_planning_extras_test.sql"

# The club counts' unclaimed roster places, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_roster_counts" >/dev/null
"${PSQL[@]}" -d rustnuts_roster_counts -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_roster_counts -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_roster_counts -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_roster_counts -f "$ROOT/supabase/tests/roster_counts_test.sql"

# The club's sponsors, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_sponsors" >/dev/null
"${PSQL[@]}" -d rustnuts_sponsors -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_sponsors -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_sponsors -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_sponsors -f "$ROOT/supabase/tests/sponsors_test.sql"
# Charity ride sign-ups, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_charity" >/dev/null
"${PSQL[@]}" -d rustnuts_charity -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_charity -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_charity -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_charity -f "$ROOT/supabase/tests/charity_signups_test.sql"

# Invites to and from other clubs, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_invites" >/dev/null
"${PSQL[@]}" -d rustnuts_invites -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_invites -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_invites -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_invites -f "$ROOT/supabase/tests/club_invites_test.sql"

# Big 4 RSVP rules and the 5.5 notice, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_big4_rsvp" >/dev/null
"${PSQL[@]}" -d rustnuts_big4_rsvp -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_big4_rsvp -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_big4_rsvp -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_big4_rsvp -f "$ROOT/supabase/tests/big4_rsvp_notices_test.sql"
# Pasted before attendance-big4.sql, it must refuse and change nothing.
"${PSQL[@]}" -c "create database rustnuts_big4_order" >/dev/null
"${PSQL[@]}" -d rustnuts_big4_order -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  [[ "$(basename "$f")" < "20270405000000" ]] || continue
  "${PSQL[@]}" -d rustnuts_big4_order -f "$f" >/dev/null 2>&1
done
"${PSQL[@]}" -d rustnuts_big4_order -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
if out="$("${PSQL[@]}" -d rustnuts_big4_order -f "$ROOT/supabase/migrations/20270510000000_big4_rsvp_notices.sql" 2>&1)"; then
  echo "The Big 4 RSVP migration applied without attendance-big4.sql"; exit 1
fi
echo "$out" | grep -q 'Paste attendance-big4.sql first.' || { echo "Wrong refusal: $out"; exit 1; }
"${PSQL[@]}" -d rustnuts_big4_order -tAc "select count(*) from pg_proc where proname = 'big4_problem'" | grep -qx 0 \
  || { echo "The Big 4 RSVP migration changed something without attendance-big4.sql"; exit 1; }
echo 'The Big 4 RSVP migration refuses to go in before attendance-big4.sql, and changes nothing'
# The family view, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_family" >/dev/null
"${PSQL[@]}" -d rustnuts_family -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_family -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_family -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_family -f "$ROOT/supabase/tests/family_view_test.sql"
# Rusty Bus extras: changing bookings, keys, odometer and running costs, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_bus_extras" >/dev/null
"${PSQL[@]}" -d rustnuts_bus_extras -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_bus_extras -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_bus_extras -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_bus_extras -f "$ROOT/supabase/tests/rusty_bus_extras_test.sql"

# The National Auditor, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_auditor" >/dev/null
"${PSQL[@]}" -d rustnuts_auditor -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_auditor -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_auditor -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_auditor -f "$ROOT/supabase/tests/auditor_test.sql"

# The launch audit's database repairs, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_audit_fixes" >/dev/null
"${PSQL[@]}" -d rustnuts_audit_fixes -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_audit_fixes -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_audit_fixes -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_audit_fixes -f "$ROOT/supabase/tests/audit_fixes_test.sql"

# Jeff's decisions from the launch audit (who sees what), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_audit_decisions" >/dev/null
"${PSQL[@]}" -d rustnuts_audit_decisions -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_audit_decisions -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_audit_decisions -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_audit_decisions -f "$ROOT/supabase/tests/audit_decisions_test.sql"

# Jeff's decisions from the launch audit (who can act: removal votes and the 5.5 gate), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_removal_and_gate" >/dev/null
"${PSQL[@]}" -d rustnuts_removal_and_gate -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_removal_and_gate -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_removal_and_gate -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_removal_and_gate -f "$ROOT/supabase/tests/removal_and_gate_test.sql"

# Delete my account, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_account_deletion" >/dev/null
"${PSQL[@]}" -d rustnuts_account_deletion -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_account_deletion -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_account_deletion -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_account_deletion -f "$ROOT/supabase/tests/account_deletion_test.sql"

# Ask the club (the club AI assistant), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_club_assistant" >/dev/null
"${PSQL[@]}" -d rustnuts_club_assistant -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_club_assistant -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_club_assistant -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_club_assistant -f "$ROOT/supabase/tests/club_assistant_test.sql"

# Draft from Otter (meeting minutes from a transcript), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_otter_minutes" >/dev/null
"${PSQL[@]}" -d rustnuts_otter_minutes -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_otter_minutes -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_otter_minutes -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_otter_minutes -f "$ROOT/supabase/tests/otter_minutes_test.sql"

# Catch me up (summaries of missed chat), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_catch_me_up" >/dev/null
"${PSQL[@]}" -d rustnuts_catch_me_up -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_catch_me_up -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_catch_me_up -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_catch_me_up -f "$ROOT/supabase/tests/catch_me_up_test.sql"

# The storage purge on account deletion, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_purge" >/dev/null
"${PSQL[@]}" -d rustnuts_purge -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_purge -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_purge -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_purge -f "$ROOT/supabase/tests/storage_purge_test.sql"

# Member content rules (App Store Guideline 1.2), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_content_rules" >/dev/null
"${PSQL[@]}" -d rustnuts_content_rules -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_content_rules -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_content_rules -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_content_rules -f "$ROOT/supabase/tests/member_content_rules_test.sql"

# The shared secret for the functions pg_cron calls, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_cron_secret" >/dev/null
"${PSQL[@]}" -d rustnuts_cron_secret -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_cron_secret -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_cron_secret -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_cron_secret -f "$ROOT/supabase/tests/cron_secret_test.sql"
"${PSQL[@]}" -d rustnuts_cron_secret -f "$ROOT/supabase/tests/pg_net_schema_test.sql"

# Website join enquiries (site-api), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_site_enquiries" >/dev/null
"${PSQL[@]}" -d rustnuts_site_enquiries -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_site_enquiries -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_site_enquiries -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_site_enquiries -f "$ROOT/supabase/tests/site_enquiries_test.sql"

# The website's public ride list (site-api), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_public_rides" >/dev/null
"${PSQL[@]}" -d rustnuts_public_rides -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_public_rides -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_public_rides -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_public_rides -f "$ROOT/supabase/tests/public_rides_test.sql"

# The performance advisor's shape of the schema (deep audit F4), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_performance" >/dev/null
"${PSQL[@]}" -d rustnuts_performance -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_performance -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_performance -f "$ROOT/supabase/tests/performance_test.sql"

echo 'ALL DATABASE CHECKS PASSED'
