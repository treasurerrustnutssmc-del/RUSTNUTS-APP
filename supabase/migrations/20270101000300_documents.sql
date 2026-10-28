-- The document library (Stage 5, part C): the club's controlled documents in the order of
-- authority (constitution v4 2.2), each version with the five facts 15.5 asks for, member
-- sign-offs and review cycles. See docs/superpowers/specs/2026-10-27-stage-5c-documents-design.md.
-- Nobody reaches these tables directly: club_documents() and document_body() read, and each
-- action below checks the rules in src/domain/documents.ts, refusing with the same words.
-- Superseded versions are kept as club records (15.5), so nothing here is ever removed.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references public.chapters (id), -- null: club-wide
  kind text not null check (kind in ('registered_rules', 'constitution', 'policy', 'procedure')),
  title text not null,
  asks_sign_off boolean not null default false,
  review_months int check (review_months between 1 and 60),
  reviewed_on date,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind in ('policy', 'procedure') or chapter_id is null)
);
-- One Registered Rules and one Constitution.
create unique index documents_one_of_each on public.documents (kind) where kind in ('registered_rules', 'constitution');

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id),
  number int not null check (number >= 1),
  label text not null,
  body text not null,
  what_changed text not null default '',
  fresh_sign_off boolean not null default true,
  approving_body text check (approving_body in
    ('association_general_meeting', 'association_committee', 'full_members', 'nec', 'chapter_board')),
  approved_on date,
  commences_on date,
  published_by uuid references public.members (id) on delete set null, -- null: imported
  published_at timestamptz not null default now(),
  unique (document_id, number),
  check ((approving_body is null) = (approved_on is null) and (approved_on is null) = (commences_on is null)),
  check (commences_on >= approved_on)
);

create table public.document_signoffs (
  version_id uuid not null references public.document_versions (id),
  member_id uuid not null references public.members (id) on delete cascade,
  signed_at timestamptz not null default now(),
  primary key (version_id, member_id)
);

alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_signoffs enable row level security;
revoke all on public.documents, public.document_versions, public.document_signoffs from public, anon, authenticated;

-- Who's who -------------------------------------------------------------------------------------

-- Approved members read everything; applicants the Registered Rules and the Constitution (15.7).
-- Mirrors readsDocument.
create or replace function private.reads_document(p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved_member() or (p_kind in ('registered_rules', 'constitution') and exists (
    select 1 from public.members where id = auth.uid() and approval = 'pending'));
$$;

-- The version in force on p_today: the highest-numbered one approved and commenced. Mirrors inForce.
create or replace function private.document_in_force(p_document uuid, p_today date)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.document_versions
  where document_id = p_document and approved_on is not null and commences_on <= p_today
  order by number desc limit 1;
$$;

-- The approval facts' own checks; all null passes. Mirrors approvalFieldsProblem.
create or replace function private.check_document_approval(p_body text, p_approved_on date, p_commences_on date)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_body is null and p_approved_on is null and p_commences_on is null then return; end if;
  if p_body is null or p_approved_on is null or p_commences_on is null then
    raise exception 'Give the approving body, the approval date and the commencement date together.';
  end if;
  if p_body not in ('association_general_meeting', 'association_committee', 'full_members', 'nec', 'chapter_board') then
    raise exception 'Pick who approved it.';
  end if;
  if p_approved_on > private.club_date() then raise exception 'The approval date can’t be in the future.'; end if;
  if p_commences_on < p_approved_on then raise exception 'It can’t commence before it was approved.'; end if;
end;
$$;

revoke all on function private.reads_document(text), private.document_in_force(uuid, date),
  private.check_document_approval(text, date, date) from public, anon, authenticated;

-- Actions ---------------------------------------------------------------------------------------

create or replace function public.create_document(
  p_chapter uuid, p_kind text, p_title text, p_asks_sign_off boolean, p_review_months int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); title text := coalesce(private.trim_like_app(p_title), ''); new_id uuid;
begin
  perform private.require_scope(p_chapter);
  if p_kind is null or p_kind not in ('registered_rules', 'constitution', 'policy', 'procedure') then
    raise exception 'Pick what kind of document it is.';
  end if;
  if p_kind in ('registered_rules', 'constitution') and p_chapter is not null then
    raise exception 'The Registered Rules and the Constitution are club-wide documents.';
  end if;
  if p_kind in ('registered_rules', 'constitution') and exists (select 1 from public.documents where kind = p_kind) then
    raise exception 'The library already has that document. Publish a new version of it instead.';
  end if;
  if title = '' then raise exception 'Give the document a title.'; end if;
  if char_length(title) > 120 then raise exception 'Keep the title to 120 characters at most.'; end if;
  if p_review_months is not null and (p_review_months < 1 or p_review_months > 60) then
    raise exception 'Pick a review cycle from 1 to 60 months, or none.';
  end if;
  begin
    insert into public.documents (chapter_id, kind, title, asks_sign_off, review_months, created_by)
    values (p_chapter, p_kind, title, coalesce(p_asks_sign_off, false), p_review_months, me)
    returning id into new_id;
  exception when unique_violation then
    -- Two people adding the Constitution (or Registered Rules) at once: the second gets the same refusal.
    raise exception 'The library already has that document. Publish a new version of it instead.';
  end;
  return new_id;
end;
$$;

-- Version 1 always asks for a fresh sign-off.
create or replace function public.publish_document_version(
  p_document uuid, p_expected int, p_label text, p_body text, p_what_changed text, p_fresh_sign_off boolean,
  p_approving_body text, p_approved_on date, p_commences_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.require_member();
  doc public.documents;
  latest int;
  label text := coalesce(private.trim_like_app(p_label), '');
  body text := coalesce(private.trim_like_app(p_body), '');
  changes text := coalesce(private.trim_like_app(p_what_changed), '');
  new_id uuid;
begin
  -- Two publishers at once: the second waits here, then sees the first one's version.
  select * into doc from public.documents where id = p_document for update;
  if not found then raise exception 'That document isn’t in the library.'; end if;
  perform private.require_scope(doc.chapter_id);
  select coalesce(max(number), 0) into latest from public.document_versions where document_id = p_document;
  if latest is distinct from p_expected then
    raise exception 'Someone else published a new version while you were editing. Your text isn’t saved: copy it, then open the document again.';
  end if;
  if label = '' then raise exception 'Give the version a label, like v2.'; end if;
  if char_length(label) > 20 then raise exception 'Keep the label to 20 characters at most.'; end if;
  if body = '' then raise exception 'Write the document’s text first.'; end if;
  if char_length(body) > 200000 then raise exception 'That’s too long (200000 characters at most).'; end if;
  if char_length(changes) > 500 then raise exception 'Keep what changed to 500 characters at most.'; end if;
  perform private.check_document_approval(p_approving_body, p_approved_on, p_commences_on);
  insert into public.document_versions (document_id, number, label, body, what_changed, fresh_sign_off,
    approving_body, approved_on, commences_on, published_by)
  values (p_document, latest + 1, label, body, changes, latest = 0 or coalesce(p_fresh_sign_off, true),
    p_approving_body, p_approved_on, p_commences_on, me)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.record_document_approval(
  p_version uuid, p_approving_body text, p_approved_on date, p_commences_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); v public.document_versions; doc public.documents;
begin
  select * into v from public.document_versions where id = p_version for update;
  if not found then raise exception 'That version isn’t in the library.'; end if;
  select * into doc from public.documents where id = v.document_id;
  perform private.require_scope(doc.chapter_id);
  if v.approved_on is not null then raise exception 'Its approval is already recorded.'; end if;
  if p_approving_body is null and p_approved_on is null and p_commences_on is null then
    raise exception 'Give the approving body, the approval date and the commencement date together.';
  end if;
  perform private.check_document_approval(p_approving_body, p_approved_on, p_commences_on);
  update public.document_versions
  set approving_body = p_approving_body, approved_on = p_approved_on, commences_on = p_commences_on
  where id = p_version;
end;
$$;

create or replace function public.mark_document_reviewed(p_document uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); doc public.documents;
begin
  select * into doc from public.documents where id = p_document;
  if not found then raise exception 'That document isn’t in the library.'; end if;
  perform private.require_scope(doc.chapter_id);
  if doc.review_months is null then raise exception 'This document has no review cycle.'; end if;
  if private.document_in_force(p_document, private.club_date()) is null then
    raise exception 'Nothing is in force yet, so there’s nothing to review.';
  end if;
  update public.documents set reviewed_on = private.club_date() where id = p_document;
end;
$$;

-- Signing again moves the date. Asked: approved, not Legacy, and for a chapter's document a
-- member of that chapter. Mirrors signDocumentProblem.
create or replace function public.sign_document(p_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_member(); v public.document_versions; doc public.documents;
begin
  select * into v from public.document_versions where id = p_version;
  if not found then raise exception 'That version isn’t in the library.'; end if;
  select * into doc from public.documents where id = v.document_id;
  if not doc.asks_sign_off then raise exception 'This document doesn’t ask for sign-off.'; end if;
  if not exists (select 1 from public.members where id = me and status <> 'legacy'
                 and (doc.chapter_id is null or chapter_id = doc.chapter_id)) then
    raise exception 'You’re not asked to sign this document.';
  end if;
  if private.document_in_force(doc.id, private.club_date()) is distinct from p_version then
    raise exception 'That version isn’t the one in force. Open the document again, then sign.';
  end if;
  insert into public.document_signoffs (version_id, member_id) values (p_version, me)
  on conflict (version_id, member_id) do update set signed_at = now();
end;
$$;

-- Reading ---------------------------------------------------------------------------------------

-- Everything but the text, which document_body() loads per version. A member gets their own
-- sign-offs; whoever runs a document's scope gets all of its sign-offs.
create or replace function public.club_documents()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'chapter_id', d.chapter_id, 'kind', d.kind, 'title', d.title, 'asks_sign_off', d.asks_sign_off,
        'review_months', d.review_months, 'reviewed_on', d.reviewed_on, 'created_by', d.created_by, 'created_at', d.created_at)
        order by d.title)
      from public.documents d where private.reads_document(d.kind)), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'document_id', v.document_id, 'number', v.number, 'label', v.label, 'what_changed', v.what_changed,
        'fresh_sign_off', v.fresh_sign_off, 'approving_body', v.approving_body, 'approved_on', v.approved_on,
        'commences_on', v.commences_on, 'published_by', v.published_by, 'published_at', v.published_at)
        order by v.document_id, v.number)
      from public.document_versions v join public.documents d on d.id = v.document_id
      where private.reads_document(d.kind)), '[]'::jsonb),
    'signoffs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'version_id', s.version_id, 'document_id', v.document_id, 'member_id', s.member_id, 'signed_at', s.signed_at)
        order by s.signed_at)
      from public.document_signoffs s
      join public.document_versions v on v.id = s.version_id
      join public.documents d on d.id = v.document_id
      where private.is_approved_member() and (s.member_id = auth.uid() or private.runs_scope(d.chapter_id))), '[]'::jsonb));
$$;

-- One version's text, or null when it isn't there or the caller can't read it.
create or replace function public.document_body(p_version uuid)
returns text language sql stable security definer set search_path = '' as $$
  select v.body from public.document_versions v join public.documents d on d.id = v.document_id
  where v.id = p_version and private.reads_document(d.kind);
$$;

revoke all on function
  public.create_document(uuid, text, text, boolean, int),
  public.publish_document_version(uuid, int, text, text, text, boolean, text, date, date),
  public.record_document_approval(uuid, text, date, date),
  public.mark_document_reviewed(uuid), public.sign_document(uuid),
  public.club_documents(), public.document_body(uuid)
  from public, anon;
grant execute on function
  public.create_document(uuid, text, text, boolean, int),
  public.publish_document_version(uuid, int, text, text, text, boolean, text, date, date),
  public.record_document_approval(uuid, text, date, date),
  public.mark_document_reviewed(uuid), public.sign_document(uuid),
  public.club_documents(), public.document_body(uuid)
  to authenticated;
