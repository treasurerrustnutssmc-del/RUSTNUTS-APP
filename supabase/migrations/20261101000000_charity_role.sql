-- Charity Committee: a club position held on top of any rank or other position (Stage 3, lane B).
-- New enum values must be committed before anything can use them, so the chat rules that mention
-- it are in the next migration.
alter type public.position_role add value if not exists 'charity_committee';
