-- Applied to the live database on 24 Oct 2026 (17:44 Melbourne) from outside this repo;
-- copied here so the repo matches live.
alter table public.positions drop constraint national_roles_have_no_chapter;
alter table public.positions add constraint national_roles_have_no_chapter
  check ((role in ('nec_chair', 'nec_secretary', 'nec_auditor', 'founder')) = (chapter_id is null));
alter table public.members add column on_hiatus boolean not null default false;
