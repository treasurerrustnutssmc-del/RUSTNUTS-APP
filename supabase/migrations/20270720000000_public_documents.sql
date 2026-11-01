-- The club website's copy of the Constitution, read through the site-api Edge Function as anon
-- (task 11 of the website-and-app list: the site shows the library's current version instead of
-- its own PDF). Only the Constitution: the version a member reads first (the one in force today,
-- or the newest when none has commenced yet; the app's shownVersion), with its title, label,
-- approval facts, publication time and text. Nothing else from the library: no Registered Rules,
-- no policies or procedures, no sign-offs, no member data. The Road Rules are not here either:
-- their written text stays with members, and the public illustrated set is app code.
-- Mirrors publicDocuments in src/domain/documents.ts.

create or replace function public.public_documents()
returns table (kind text, title text, label text, approving_body text, approved_on date, commences_on date,
               published_at timestamptz, body text)
language sql stable security definer set search_path = '' as $$
  select d.kind, d.title, v.label, v.approving_body, v.approved_on, v.commences_on, v.published_at, v.body
  from public.documents d
  join public.document_versions v on v.id = coalesce(
    private.document_in_force(d.id, private.club_date()),
    (select n.id from public.document_versions n where n.document_id = d.id order by n.number desc limit 1))
  where d.kind = 'constitution';
$$;
revoke all on function public.public_documents() from public;
grant execute on function public.public_documents() to anon, authenticated;
