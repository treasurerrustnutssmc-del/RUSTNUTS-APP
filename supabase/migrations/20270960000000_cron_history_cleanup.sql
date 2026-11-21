-- pg_cron keeps a row for every job run and never clears them. With send-push and voice-sweep
-- running every minute that is ~3,000 rows a day (69,000 by 21 Nov 2026, the largest table),
-- and it adds disk work on the small database. Keep two days of history and clear the rest
-- nightly. Only the log of past runs is touched; no job or app data changes.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and to_regclass('cron.job_run_details') is not null then
    delete from cron.job_run_details where end_time < now() - interval '2 days';
    perform cron.schedule('cron-history-cleanup', '41 3 * * *',
      $job$delete from cron.job_run_details where end_time < now() - interval '2 days'$job$);
  end if;
end $$;
