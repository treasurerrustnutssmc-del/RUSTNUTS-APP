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
node "$ROOT/scripts/parity-sql.mjs" | "${PSQL[@]}" -d rustnuts_parity
echo 'ALL DATABASE CHECKS PASSED'
