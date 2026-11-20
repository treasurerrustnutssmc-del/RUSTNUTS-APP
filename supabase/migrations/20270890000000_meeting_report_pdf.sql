-- The treasurer's own PDF on a Treasurer's Report for a meeting (Jeff, 21 Nov 2026): whoever keeps
-- the Club fund's books picks a PDF from the phone and it's attached to a draft; once presented it's
-- locked with the report and every member who reads presented reports can open it.
-- Spec: docs/superpowers/specs/2026-11-21-treasurer-own-pdf-design.md. Mirrors attachPdfProblem and
-- removePdfProblem in src/domain/meetingReport.ts. Safe to run twice.

alter table public.treasurer_meeting_reports
  add column if not exists pdf_path text,
  add column if not exists pdf_name text;

do $$ begin
  alter table public.treasurer_meeting_reports add constraint treasurer_meeting_reports_pdf
    check ((pdf_path is null) = (pdf_name is null) and (pdf_name is null or char_length(pdf_name) between 1 and 120));
exception when duplicate_object then null;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('treasurer-reports', 'treasurer-reports', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Who's who for the files ------------------------------------------------------------------------

-- Keeps the Club fund's books (keeps_books itself isn't callable from a policy).
create or replace function private.keeps_club_books()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.keeps_books(null);
$$;

-- The first folder of p_name is a draft report's id.
create or replace function private.meeting_pdf_folder_is_draft(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.treasurer_meeting_reports
    where id::text = split_part(p_name, '/', 1) and presented_at is null);
$$;

-- Attached to a presented report, and the caller reads presented reports: approved members who
-- haven't left, never Family (as meeting_reports() in 20270530000000_family_view.sql).
create or replace function private.reads_meeting_pdf(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.treasurer_meeting_reports where pdf_path = p_name and presented_at is not null)
    and private.is_approved_member() and exists (select 1 from public.members where id = auth.uid() and status <> 'legacy');
$$;

create or replace function private.meeting_pdf_in_use(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.treasurer_meeting_reports where pdf_path = p_name);
$$;

revoke all on function private.keeps_club_books(), private.meeting_pdf_folder_is_draft(text), private.reads_meeting_pdf(text),
  private.meeting_pdf_in_use(text) from public, anon;
grant execute on function private.keeps_club_books(), private.meeting_pdf_folder_is_draft(text), private.reads_meeting_pdf(text),
  private.meeting_pdf_in_use(text) to authenticated;

drop policy if exists treasurer_reports_upload on storage.objects;
drop policy if exists treasurer_reports_read on storage.objects;
drop policy if exists treasurer_reports_tidy on storage.objects;

create policy treasurer_reports_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'treasurer-reports' and private.keeps_club_books() and private.meeting_pdf_folder_is_draft(name));
create policy treasurer_reports_read on storage.objects for select to authenticated
  using (bucket_id = 'treasurer-reports' and (private.keeps_club_books() or private.reads_meeting_pdf(name)));
create policy treasurer_reports_tidy on storage.objects for delete to authenticated
  using (bucket_id = 'treasurer-reports' and private.keeps_club_books() and not private.meeting_pdf_in_use(name));

-- Actions ---------------------------------------------------------------------------------------

-- Attaches the uploaded file (p_path under the report's folder) or, with p_path null, removes it.
-- A replaced or removed file is queued for the purge job.
create or replace function public.set_meeting_report_pdf(p_id uuid, p_path text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.treasurer_meeting_reports;
  v_name text := left(trim(coalesce(p_name, '')), 120);
begin
  perform private.require_books(null);
  select * into r from public.treasurer_meeting_reports where id = p_id for update;
  if not found then raise exception 'No such report.'; end if;
  if r.presented_at is not null then raise exception 'That report is presented and can’t be changed.'; end if;
  if p_path is not null then
    if split_part(p_path, '/', 1) <> p_id::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'treasurer-reports' and o.name = p_path) then
      raise exception 'That PDF didn’t upload. Try again.';
    end if;
    if v_name = '' then v_name := 'Treasurer’s report.pdf'; end if; -- as pdfFileName
    -- A path queued for the purge job (direct calls only; the app makes a fresh one) comes off the queue.
    delete from private.storage_purge where bucket = 'treasurer-reports' and path = p_path and done_at is null;
  end if;
  if r.pdf_path is not null and r.pdf_path is distinct from p_path then
    insert into private.storage_purge (bucket, path) values ('treasurer-reports', r.pdf_path);
  end if;
  update public.treasurer_meeting_reports
    set pdf_path = p_path, pdf_name = case when p_path is null then null else v_name end
    where id = p_id;
end;
$$;

-- As before, and the draft's file is queued for the purge job.
create or replace function public.delete_meeting_report(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  perform private.require_books(null);
  if not exists (select 1 from public.treasurer_meeting_reports where id = p_id) then raise exception 'No such report.'; end if;
  delete from public.treasurer_meeting_reports where id = p_id and presented_at is null returning pdf_path into v_path;
  if not found then raise exception 'That report is presented and can’t be changed.'; end if;
  if v_path is not null then
    insert into private.storage_purge (bucket, path) values ('treasurer-reports', v_path);
  end if;
end;
$$;

-- As in 20270530000000_family_view.sql, with the attached PDF's path and name.
create or replace function public.meeting_reports()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  keeper boolean := private.keeps_books(null);
  reader boolean := private.is_approved_member() and exists (
    select 1 from public.members where id = auth.uid() and status <> 'legacy');
begin
  if not (keeper or reader) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'from_on', r.from_on, 'to_on', r.to_on, 'notes', r.notes, 'saved_by', r.saved_by, 'saved_at', r.saved_at,
      'presented_by', r.presented_by, 'presented_at', r.presented_at, 'pdf_path', r.pdf_path, 'pdf_name', r.pdf_name,
      'figures', private.meeting_report(r.from_on, r.to_on)) order by r.to_on desc, r.saved_at desc)
    from public.treasurer_meeting_reports r
    where r.presented_at is not null or keeper), '[]'::jsonb);
end;
$$;

revoke all on function public.set_meeting_report_pdf(uuid, text, text), public.delete_meeting_report(uuid), public.meeting_reports()
  from public, anon;
grant execute on function public.set_meeting_report_pdf(uuid, text, text), public.delete_meeting_report(uuid), public.meeting_reports()
  to authenticated;
