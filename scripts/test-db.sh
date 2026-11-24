#!/usr/bin/env bash
# Spins up a throwaway Postgres, applies the migrations and runs the access checks.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")"
WORK="$(mktemp -d)"
PORT="${TEST_DB_PORT:-54329}"
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
# The app writes 1,000 with a comma; no database message may still say "1000 characters".
[ "$("${PSQL[@]}" -d rustnuts_parity -tAc "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc like '%1000 characters%'")" = 0 ] \
  || { echo 'A database message still says "1000 characters"'; exit 1; }
echo 'Database messages write 1,000 with a comma, like the app'

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

# Chat notifications stack per chat, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_chat_push_stack" >/dev/null
"${PSQL[@]}" -d rustnuts_chat_push_stack -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_chat_push_stack -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_chat_push_stack -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_chat_push_stack -f "$ROOT/supabase/tests/chat_push_stack_test.sql"

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

# Board files, a folder for every seat, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_board_files" >/dev/null
"${PSQL[@]}" -d rustnuts_board_files -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_board_files -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_board_files -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_board_files -f "$ROOT/supabase/tests/board_files_test.sql"

# Club spending for members, member names taken out, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_club_spending" >/dev/null
"${PSQL[@]}" -d rustnuts_club_spending -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_club_spending -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_club_spending -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_club_spending -f "$ROOT/supabase/tests/club_spending_test.sql"

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

# Rides made in the app (save_ride, set_ride_called_off), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_app_rides" >/dev/null
"${PSQL[@]}" -d rustnuts_app_rides -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_app_rides -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_app_rides -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_app_rides -f "$ROOT/supabase/tests/app_rides_test.sql"
# Rides ridden in legs, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_ride_legs" >/dev/null
"${PSQL[@]}" -d rustnuts_ride_legs -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_ride_legs -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_ride_legs -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_ride_legs -f "$ROOT/supabase/tests/ride_legs_test.sql"

# "I'm here" check-in (no QR), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_im_here" >/dev/null
"${PSQL[@]}" -d rustnuts_im_here -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_im_here -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_im_here -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_im_here -f "$ROOT/supabase/tests/im_here_checkin_test.sql"

# The performance advisor's shape of the schema (deep audit F4), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_performance" >/dev/null
"${PSQL[@]}" -d rustnuts_performance -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_performance -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_performance -f "$ROOT/supabase/tests/performance_test.sql"

# Charity ride sign-ups from the club website (site-api), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_website_signups" >/dev/null
"${PSQL[@]}" -d rustnuts_website_signups -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_website_signups -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_website_signups -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_website_signups -f "$ROOT/supabase/tests/website_signups_test.sql"
# The club website's Constitution feed (site-api), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_public_documents" >/dev/null
"${PSQL[@]}" -d rustnuts_public_documents -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_public_documents -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_public_documents -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_public_documents -f "$ROOT/supabase/tests/public_documents_test.sql"
# Club news for the website (site-api), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_site_news" >/dev/null
"${PSQL[@]}" -d rustnuts_site_news -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_site_news -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_site_news -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_site_news -f "$ROOT/supabase/tests/site_news_test.sql"
# Club photos on the website (site-api), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_site_photos" >/dev/null
"${PSQL[@]}" -d rustnuts_site_photos -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_site_photos -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_site_photos -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_site_photos -f "$ROOT/supabase/tests/site_photos_test.sql"
# Website visitor counts (site-api), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_site_visits" >/dev/null
"${PSQL[@]}" -d rustnuts_site_visits -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_site_visits -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_site_visits -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_site_visits -f "$ROOT/supabase/tests/site_visits_test.sql"
# App feedback and issues, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_app_feedback" >/dev/null
"${PSQL[@]}" -d rustnuts_app_feedback -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_app_feedback -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_app_feedback -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_app_feedback -f "$ROOT/supabase/tests/app_feedback_test.sql"
# App usage counts (anonymous), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_app_usage" >/dev/null
"${PSQL[@]}" -d rustnuts_app_usage -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_app_usage -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_app_usage -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_app_usage -f "$ROOT/supabase/tests/app_usage_test.sql"

# The club shop (in-app merch ordering into Make), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_shop" >/dev/null
"${PSQL[@]}" -d rustnuts_shop -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_shop -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_shop -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_shop -f "$ROOT/supabase/tests/shop_test.sql"

# The club shop's product pictures, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_shop_pictures" >/dev/null
"${PSQL[@]}" -d rustnuts_shop_pictures -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_shop_pictures -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_shop_pictures -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_shop_pictures -f "$ROOT/supabase/tests/shop_pictures_test.sql"

# The voice sweep (ChatGPT audit F03), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_voice_sweep" >/dev/null
"${PSQL[@]}" -d rustnuts_voice_sweep -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_voice_sweep -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_voice_sweep -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_voice_sweep -f "$ROOT/supabase/tests/voice_sweep_test.sql"

# Ride comms bubbles (who's on each ride's comms, counts, emergencies to comms), on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_comms_bubbles" >/dev/null
"${PSQL[@]}" -d rustnuts_comms_bubbles -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_comms_bubbles -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_comms_bubbles -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_comms_bubbles -f "$ROOT/supabase/tests/ride_comms_bubbles_test.sql"

# The Family chat, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_family_chat" >/dev/null
"${PSQL[@]}" -d rustnuts_family_chat -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_family_chat -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_family_chat -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_family_chat -f "$ROOT/supabase/tests/family_chat_test.sql"

# Group chats and the All boards chat, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_chat_groups" >/dev/null
"${PSQL[@]}" -d rustnuts_chat_groups -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_chat_groups -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_chat_groups -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_chat_groups -f "$ROOT/supabase/tests/chat_groups_test.sql"

# Topics inside board, committee and group chats, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_chat_topics" >/dev/null
"${PSQL[@]}" -d rustnuts_chat_topics -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_chat_topics -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_chat_topics -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_chat_topics -f "$ROOT/supabase/tests/chat_topics_test.sql"

# The sign-up block list, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_blocked_signups" >/dev/null
"${PSQL[@]}" -d rustnuts_blocked_signups -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_blocked_signups -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_blocked_signups -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_blocked_signups -f "$ROOT/supabase/tests/blocked_signups_test.sql"

# No stored passwords, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_no_passwords" >/dev/null
"${PSQL[@]}" -d rustnuts_no_passwords -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_no_passwords -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_no_passwords -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_no_passwords -f "$ROOT/supabase/tests/no_passwords_test.sql"

# Acting in a role, until a date, on a fresh copy of the schema.
"${PSQL[@]}" -c "create database rustnuts_acting" >/dev/null
"${PSQL[@]}" -d rustnuts_acting -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d rustnuts_acting -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_acting -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_acting -f "$ROOT/supabase/tests/acting_test.sql"
# The acting migration on a database with open NEC votes: each open NEC ballot gets the chapter of
# its elector's open President seat, else their VP seat, else their own chapter. Nothing else moves.
"${PSQL[@]}" -c "create database rustnuts_acting_backfill" >/dev/null
"${PSQL[@]}" -d rustnuts_acting_backfill -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  [[ "$(basename "$f")" < "20270870000000" ]] || continue
  "${PSQL[@]}" -d rustnuts_acting_backfill -f "$f" >/dev/null
done
"${PSQL[@]}" -d rustnuts_acting_backfill -f "$ROOT/supabase/tests/test_defaults.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_acting_backfill >/dev/null <<'SQL'
insert into public.chapters (slug, name, area, state) values ('east', 'East', 'Eastern Melbourne', 'VIC'), ('south', 'South', 'Southern Melbourne', 'VIC');
insert into auth.users (id, email, email_confirmed_at)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'b' || n || '@example.com', now() from generate_series(1, 5) n;
-- 1 Smokey (South): West VP since January, North President since June. 2 Jet (North): East VP.
-- 3 Crank (West): no seat. 4 Lou (North): South President until September, East Secretary since.
-- 5 Ned (West): West President, on a closed NEC vote and an open board vote only.
insert into public.members (id, chapter_id, full_name, status, approval)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, (select id from public.chapters where slug = ch), name, 'full', 'approved'
from (values (1, 'south', 'Smokey Stone'), (2, 'north', 'Jet Black'), (3, 'west', 'Crank Shaw'),
  (4, 'north', 'Lou Reed'), (5, 'west', 'Ned Kelly')) as v(n, ch, name);
insert into public.positions (member_id, chapter_id, role, started_on, ended_on)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, (select id from public.chapters where slug = ch), r::public.position_role, s::date, e::date
from (values (1, 'west', 'vice_president', '2026-01-01', null), (1, 'north', 'president', '2026-06-01', null),
  (2, 'east', 'vice_president', '2026-03-01', null), (4, 'south', 'president', '2026-01-01', '2026-09-01'),
  (4, 'east', 'secretary', '2026-09-02', null), (5, 'west', 'president', '2026-01-01', null)) as v(n, ch, r, s, e);
insert into public.votes (id, chapter_id, question, electorate, threshold, quorum, opened_at, closes_at, closed_at, result) values
  ('00000000-0000-0000-0000-000000000101', null, 'Open NEC vote', 'nec', 'majority', 2, now() - interval '1 day', now() + interval '6 days', null, null),
  ('00000000-0000-0000-0000-000000000102', null, 'Closed NEC vote', 'nec', 'majority', 2, now() - interval '9 days', now() - interval '2 days', now() - interval '2 days', 'carried'),
  ('00000000-0000-0000-0000-000000000103', (select id from public.chapters where slug = 'west'), 'Open board vote', 'chapter_board', 'majority', 2,
    now() - interval '1 day', now() + interval '6 days', null, null);
insert into public.vote_electors (vote_id, member_id)
select ('00000000-0000-0000-0000-000000000' || v)::uuid, ('00000000-0000-0000-0000-00000000000' || n)::uuid
from (values (101, 1), (101, 2), (101, 3), (101, 4), (102, 5), (103, 5)) as e(v, n);
SQL
"${PSQL[@]}" -d rustnuts_acting_backfill -f "$ROOT/supabase/migrations/20270870000000_acting_roles.sql" >/dev/null
"${PSQL[@]}" -d rustnuts_acting_backfill >/dev/null <<'SQL'
do $$
declare
  open_nec constant uuid := '00000000-0000-0000-0000-000000000101';
  ch uuid;
begin
  select for_chapter into ch from public.vote_electors where vote_id = open_nec and member_id = '00000000-0000-0000-0000-000000000001';
  assert ch = (select id from public.chapters where slug = 'north'), 'Smokey''s ballot is North''s: his President seat, before his older VP seat';
  select for_chapter into ch from public.vote_electors where vote_id = open_nec and member_id = '00000000-0000-0000-0000-000000000002';
  assert ch = (select id from public.chapters where slug = 'east'), 'Jet''s is East''s: his VP seat, not his own chapter';
  select for_chapter into ch from public.vote_electors where vote_id = open_nec and member_id = '00000000-0000-0000-0000-000000000003';
  assert ch = (select id from public.chapters where slug = 'west'), 'Crank has no seat: his own chapter';
  select for_chapter into ch from public.vote_electors where vote_id = open_nec and member_id = '00000000-0000-0000-0000-000000000004';
  assert ch = (select id from public.chapters where slug = 'north'), 'Lou''s ended President seat and Secretary seat don''t count: his own chapter';
  assert not exists (select 1 from public.vote_electors where vote_id <> open_nec and for_chapter is not null),
    'a closed NEC vote and a board vote are left alone';
end $$;
SQL
echo 'The acting migration gives each open NEC ballot its chapter: President seat, then VP seat, then their own'
# Pasted again, as one transaction, it stops at once and says it is already in. Pasted again in a
# client that keeps going after errors, the backfill only fills empty values, so an open NEC ballot
# keeps the chapter open_vote or cast_ballot gave it.
"${PSQL[@]}" -d rustnuts_acting_backfill -c "update public.vote_electors set for_chapter = (select id from public.chapters where slug = 'west') where vote_id = '00000000-0000-0000-0000-000000000101' and member_id = '00000000-0000-0000-0000-000000000001'" >/dev/null
again="$("${PSQL[@]}" -d rustnuts_acting_backfill --single-transaction -f "$ROOT/supabase/migrations/20270870000000_acting_roles.sql" 2>&1 || true)"
grep -q 'The acting roles migration is already in' <<<"$again" \
  || { echo "A second paste of the acting migration didn't say it is already in: $again"; exit 1; }
psql -h "$WORK" -p "$PORT" -U postgres -q -X -d rustnuts_acting_backfill -f "$ROOT/supabase/migrations/20270870000000_acting_roles.sql" >/dev/null 2>&1 || true
[ "$("${PSQL[@]}" -d rustnuts_acting_backfill -tAc "select c.slug from public.vote_electors e join public.chapters c on c.id = e.for_chapter where e.vote_id = '00000000-0000-0000-0000-000000000101' and e.member_id = '00000000-0000-0000-0000-000000000001'")" = west ] \
  || { echo 'A second paste of the acting migration moved an open NEC ballot to another chapter'; exit 1; }
echo 'A second paste of the acting migration says it is already in, and moves no NEC ballot'

echo 'ALL DATABASE CHECKS PASSED'
