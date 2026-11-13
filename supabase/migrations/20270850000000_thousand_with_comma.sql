-- "1,000" with a comma, as the app says it (9379033, 12 Nov 2026). Five functions still raised
-- "1000 characters", so the demo and the database refused the same thing in different words.
-- Each function is re-created from its own current definition with only that text changed, so
-- nothing else about it (body, security, search_path, grants) moves.
do $$
declare
  f regprocedure;
  def text;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('save_hub', 'record_conduct', 'lodge_conduct_appeal', 'decide_conduct_appeal', 'propose_contribution')
      and p.prosrc like '%1000 characters at most%'
  loop
    def := pg_get_functiondef(f);
    execute replace(def, '1000 characters at most', '1,000 characters at most');
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosrc like '%1000 characters%') then
    raise exception 'A database message still says "1000 characters"';
  end if;
end $$;
