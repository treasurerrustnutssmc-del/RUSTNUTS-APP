-- Applied to the live database on 24 Oct 2026 (17:44 Melbourne) from outside this repo;
-- copied here so the repo matches live.
alter type public.position_role add value if not exists 'ride_committee';
alter type public.position_role add value if not exists 'assistant_tail_gunner';
alter type public.position_role add value if not exists 'founder';
