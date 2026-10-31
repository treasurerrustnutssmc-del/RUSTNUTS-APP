-- Test databases only (scripts/test-db.sh runs this after the migrations, before each test file).
-- Every member in a test has agreed to the club rules for chats and posts unless the test says
-- otherwise. The live column has no default: real members agree in the app.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'members' and column_name = 'posting_rules_accepted_on') then
    alter table public.members alter column posting_rules_accepted_on set default current_date;
  end if;
end $$;
