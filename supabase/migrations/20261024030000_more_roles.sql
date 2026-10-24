-- Roles the real club uses that Stage 1 didn't have. New enum values must be committed before
-- anything can use them, so the rules that mention them are in the next migration.
alter type public.position_role add value if not exists 'ride_committee';
alter type public.position_role add value if not exists 'assistant_tail_gunner';
alter type public.position_role add value if not exists 'founder';
