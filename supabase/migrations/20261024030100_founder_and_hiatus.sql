-- Founder is a national title (no chapter) that carries no powers of its own: is_national() still
-- only counts the NEC roles and sitting Presidents.
alter table public.positions drop constraint national_roles_have_no_chapter;
alter table public.positions add constraint national_roles_have_no_chapter
  check ((role in ('nec_chair', 'nec_secretary', 'nec_auditor', 'founder')) = (chapter_id is null));

-- A patched member taking a break keeps their status and patch; they're just flagged as away.
alter table public.members add column on_hiatus boolean not null default false;
