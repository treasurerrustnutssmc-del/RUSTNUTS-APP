-- Rustnuts app: LIVE database export, taken 2 Nov 2026 from the production Supabase project.
-- Structure and code only. No member data, no secret values. Read-only reference for auditors.
-- Tables in the public and private schemas, with columns, constraints, indexes and whether row-level security is on.
-- Part 1 of 2.

-- private.app_settings  [RLS ON]
create table private.app_settings (
  key text not null,
  value text not null,
  constraint app_settings_pkey PRIMARY KEY (key)
);

-- private.assistant_days  [RLS ON]
create table private.assistant_days (
  member_id uuid not null,
  day date not null,
  questions integer not null default 0,
  constraint assistant_days_pkey PRIMARY KEY (member_id, day),
  constraint assistant_days_questions_check CHECK ((questions >= 0))
);

-- private.assistant_months  [RLS ON]
create table private.assistant_months (
  month date not null,
  questions integer not null default 0,
  spent_microusd bigint not null default 0,
  constraint assistant_months_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric)),
  constraint assistant_months_pkey PRIMARY KEY (month),
  constraint assistant_months_questions_check CHECK ((questions >= 0)),
  constraint assistant_months_spent_microusd_check CHECK ((spent_microusd >= 0))
);

-- private.link_previews  [RLS ON]
create table private.link_previews (
  url text not null,
  preview jsonb,
  fetched_at timestamp with time zone not null default now(),
  constraint link_previews_pkey PRIMARY KEY (url)
);

-- private.minutes_drafts  [RLS ON]
create table private.minutes_drafts (
  meeting_id uuid not null,
  drafts integer not null default 0,
  constraint minutes_drafts_drafts_check CHECK ((drafts >= 0)),
  constraint minutes_drafts_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  constraint minutes_drafts_pkey PRIMARY KEY (meeting_id)
);

-- private.push_outbox  [RLS ON]
create table private.push_outbox (
  id bigint not null default nextval('private.push_outbox_id_seq'::regclass),
  member_id uuid not null,
  dedupe_key text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'queued'::text,
  created_at timestamp with time zone not null default now(),
  sent_at timestamp with time zone,
  constraint push_outbox_member_id_dedupe_key_key UNIQUE (member_id, dedupe_key),
  constraint push_outbox_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint push_outbox_pkey PRIMARY KEY (id),
  constraint push_outbox_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'held'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);
CREATE UNIQUE INDEX push_outbox_member_id_dedupe_key_key ON private.push_outbox USING btree (member_id, dedupe_key);
CREATE INDEX push_outbox_queued ON private.push_outbox USING btree (id) WHERE (status = 'queued'::text);

-- private.ride_feeds  [RLS ON]
create table private.ride_feeds (
  id uuid not null default gen_random_uuid(),
  url text not null,
  category ride_category,
  last_ok_at timestamp with time zone,
  last_error text,
  constraint ride_feeds_pkey PRIMARY KEY (id)
);

-- private.roster  [RLS ON]
create table private.roster (
  id uuid not null default gen_random_uuid(),
  email text not null,
  chapter_id uuid not null,
  full_name text not null,
  road_name text,
  status member_status not null,
  joined_on date,
  patched_on date,
  fng_started_on date,
  on_hiatus boolean not null default false,
  roles position_role[] not null default '{}'::position_role[],
  claimed_by uuid,
  claimed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  phone text,
  emergency_name text,
  emergency_relationship text,
  emergency_phone text,
  bike_make text,
  bike_model text,
  bike_rego text,
  constraint roster_bike_whole CHECK ((((NULLIF(TRIM(BOTH FROM bike_make), ''::text) IS NULL) = (NULLIF(TRIM(BOTH FROM bike_model), ''::text) IS NULL)) AND ((NULLIF(TRIM(BOTH FROM bike_rego), ''::text) IS NULL) OR (NULLIF(TRIM(BOTH FROM bike_make), ''::text) IS NOT NULL)))),
  constraint roster_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint roster_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint roster_emergency_whole CHECK ((((NULLIF(TRIM(BOTH FROM emergency_name), ''::text) IS NULL) = (NULLIF(TRIM(BOTH FROM emergency_phone), ''::text) IS NULL)) AND ((NULLIF(TRIM(BOTH FROM emergency_relationship), ''::text) IS NULL) OR (NULLIF(TRIM(BOTH FROM emergency_name), ''::text) IS NOT NULL)))),
  constraint roster_full_name_check CHECK ((length(TRIM(BOTH FROM full_name)) > 0)),
  constraint roster_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX roster_email ON private.roster USING btree (lower(TRIM(BOTH FROM email)));
CREATE INDEX roster_chapter_id_idx ON private.roster USING btree (chapter_id);
CREATE INDEX roster_claimed_by_idx ON private.roster USING btree (claimed_by);

-- private.storage_purge  [RLS ON]
create table private.storage_purge (
  id bigint not null default nextval('private.storage_purge_id_seq'::regclass),
  bucket text not null,
  path text not null,
  member_id uuid,
  queued_at timestamp with time zone not null default now(),
  taken_at timestamp with time zone,
  done_at timestamp with time zone,
  attempts integer not null default 0,
  error text,
  constraint storage_purge_pkey PRIMARY KEY (id)
);
CREATE INDEX storage_purge_pending ON private.storage_purge USING btree (id) WHERE (done_at IS NULL);

-- public.action_items  [RLS ON]
create table public.action_items (
  id uuid not null default gen_random_uuid(),
  meeting_id uuid,
  chapter_id uuid,
  title text not null,
  owner_id uuid not null,
  due_on date,
  done_on date,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  constraint action_items_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint action_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES members(id),
  constraint action_items_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES meetings(id),
  constraint action_items_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES members(id),
  constraint action_items_pkey PRIMARY KEY (id)
);
CREATE INDEX action_items_chapter_id_idx ON public.action_items USING btree (chapter_id);
CREATE INDEX action_items_created_by_idx ON public.action_items USING btree (created_by);
CREATE INDEX action_items_meeting_id_idx ON public.action_items USING btree (meeting_id);
CREATE INDEX action_items_owner_id_idx ON public.action_items USING btree (owner_id);

-- public.agms  [RLS ON]
create table public.agms (
  year integer not null,
  held_on date not null,
  recorded_by uuid,
  recorded_at timestamp with time zone not null default now(),
  constraint agms_check CHECK (((EXTRACT(year FROM held_on))::integer = year)),
  constraint agms_pkey PRIMARY KEY (year),
  constraint agms_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX agms_recorded_by_idx ON public.agms USING btree (recorded_by);

-- public.app_feedback  [RLS ON]
create table public.app_feedback (
  id uuid not null default gen_random_uuid(),
  member_id uuid not null,
  kind text not null,
  body text not null,
  where_in_app text,
  screenshot_path text,
  app_version text not null default ''::text,
  build text not null default ''::text,
  device text not null default ''::text,
  status text not null default 'new'::text,
  reply text,
  replied_by uuid,
  replied_at timestamp with time zone,
  reply_count integer not null default 0,
  status_changed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint app_feedback_app_version_check CHECK ((length(app_version) <= 40)),
  constraint app_feedback_body_check CHECK (((length(body) >= 1) AND (length(body) <= 1000))),
  constraint app_feedback_build_check CHECK ((length(build) <= 80)),
  constraint app_feedback_device_check CHECK ((length(device) <= 120)),
  constraint app_feedback_kind_check CHECK ((kind = ANY (ARRAY['bug'::text, 'idea'::text, 'other'::text]))),
  constraint app_feedback_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint app_feedback_pkey PRIMARY KEY (id),
  constraint app_feedback_replied_by_fkey FOREIGN KEY (replied_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint app_feedback_reply_check CHECK ((length(reply) <= 600)),
  constraint app_feedback_status_check CHECK ((status = ANY (ARRAY['new'::text, 'looking'::text, 'done'::text]))),
  constraint app_feedback_where_in_app_check CHECK ((length(where_in_app) <= 60))
);
CREATE INDEX app_feedback_member_created_idx ON public.app_feedback USING btree (member_id, created_at);
CREATE INDEX app_feedback_replied_by_idx ON public.app_feedback USING btree (replied_by);
CREATE INDEX app_feedback_created_idx ON public.app_feedback USING btree (created_at);

-- public.attendance  [RLS ON]
create table public.attendance (
  session_id uuid not null,
  member_id uuid not null,
  checked_in_at timestamp with time zone not null default now(),
  marked_by uuid,
  constraint attendance_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint attendance_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint attendance_pkey PRIMARY KEY (session_id, member_id),
  constraint attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES checkin_sessions(id) ON DELETE CASCADE
);
CREATE INDEX attendance_member ON public.attendance USING btree (member_id);
CREATE INDEX attendance_marked_by_idx ON public.attendance USING btree (marked_by);

-- public.attendance_exemptions  [RLS ON]
create table public.attendance_exemptions (
  session_id uuid not null,
  member_id uuid not null,
  reason text not null,
  granted_by uuid,
  granted_at timestamp with time zone not null default now(),
  constraint attendance_exemptions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint attendance_exemptions_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint attendance_exemptions_pkey PRIMARY KEY (session_id, member_id),
  constraint attendance_exemptions_reason_check CHECK (((length(TRIM(BOTH FROM reason)) >= 1) AND (length(TRIM(BOTH FROM reason)) <= 200))),
  constraint attendance_exemptions_session_id_fkey FOREIGN KEY (session_id) REFERENCES checkin_sessions(id) ON DELETE CASCADE
);
CREATE INDEX attendance_exemptions_member ON public.attendance_exemptions USING btree (member_id);
CREATE INDEX attendance_exemptions_granted_by_idx ON public.attendance_exemptions USING btree (granted_by);

-- public.audit_reports  [RLS ON]
create table public.audit_reports (
  id uuid not null default gen_random_uuid(),
  title text not null,
  from_on date not null,
  to_on date not null,
  findings text not null,
  recommendations text,
  written_by uuid,
  saved_at timestamp with time zone not null default now(),
  issued_at timestamp with time zone,
  constraint audit_reports_check CHECK ((to_on >= from_on)),
  constraint audit_reports_findings_check CHECK (((char_length(findings) >= 1) AND (char_length(findings) <= 20000))),
  constraint audit_reports_pkey PRIMARY KEY (id),
  constraint audit_reports_recommendations_check CHECK ((char_length(recommendations) <= 20000)),
  constraint audit_reports_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 120))),
  constraint audit_reports_written_by_fkey FOREIGN KEY (written_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX audit_reports_written_by_idx ON public.audit_reports USING btree (written_by);

-- public.audit_requests  [RLS ON]
create table public.audit_requests (
  id uuid not null default gen_random_uuid(),
  chapter_id uuid,
  kind text not null,
  area text not null,
  title text not null,
  details text not null,
  due_on date,
  ledger_entry_id uuid,
  raised_by uuid,
  raised_at timestamp with time zone not null default now(),
  answer text,
  answered_by uuid,
  answered_at timestamp with time zone,
  closed_at timestamp with time zone,
  closed_by uuid,
  close_note text,
  constraint audit_requests_answer_check CHECK (((char_length(answer) >= 1) AND (char_length(answer) <= 4000))),
  constraint audit_requests_answered_by_fkey FOREIGN KEY (answered_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint audit_requests_area_check CHECK ((area = ANY (ARRAY['policy'::text, 'membership'::text, 'attendance'::text, 'event_funds'::text, 'bank'::text, 'transactions'::text, 'controls'::text]))),
  constraint audit_requests_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint audit_requests_check CHECK (((closed_at IS NULL) = (close_note IS NULL))),
  constraint audit_requests_close_note_check CHECK (((char_length(close_note) >= 1) AND (char_length(close_note) <= 1000))),
  constraint audit_requests_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint audit_requests_details_check CHECK (((char_length(details) >= 1) AND (char_length(details) <= 4000))),
  constraint audit_requests_kind_check CHECK ((kind = ANY (ARRAY['information'::text, 'correction'::text]))),
  constraint audit_requests_ledger_entry_id_fkey FOREIGN KEY (ledger_entry_id) REFERENCES ledger_entries(id) ON DELETE SET NULL,
  constraint audit_requests_pkey PRIMARY KEY (id),
  constraint audit_requests_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint audit_requests_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 120)))
);
CREATE INDEX audit_requests_answered_by_idx ON public.audit_requests USING btree (answered_by);
CREATE INDEX audit_requests_chapter_id_idx ON public.audit_requests USING btree (chapter_id);
CREATE INDEX audit_requests_closed_by_idx ON public.audit_requests USING btree (closed_by);
CREATE INDEX audit_requests_ledger_entry_id_idx ON public.audit_requests USING btree (ledger_entry_id);
CREATE INDEX audit_requests_raised_by_idx ON public.audit_requests USING btree (raised_by);

-- public.big4_rides  [RLS ON]
create table public.big4_rides (
  ride_id uuid not null,
  chapter_id uuid,
  designated_by uuid,
  designated_at timestamp with time zone not null default now(),
  constraint big4_rides_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  constraint big4_rides_designated_by_fkey FOREIGN KEY (designated_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint big4_rides_pkey PRIMARY KEY (ride_id),
  constraint big4_rides_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
);
CREATE INDEX big4_rides_chapter_id_idx ON public.big4_rides USING btree (chapter_id);
CREATE INDEX big4_rides_designated_by_idx ON public.big4_rides USING btree (designated_by);

-- public.big4_waivers  [RLS ON]
create table public.big4_waivers (
  ride_id uuid not null,
  member_id uuid not null,
  ground text not null,
  granted_by uuid,
  granted_at timestamp with time zone not null default now(),
  constraint big4_waivers_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint big4_waivers_ground_check CHECK ((ground = ANY (ARRAY['work'::text, 'family'::text, 'health'::text, 'injury'::text, 'distance'::text]))),
  constraint big4_waivers_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint big4_waivers_pkey PRIMARY KEY (ride_id, member_id),
  constraint big4_waivers_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
);
CREATE INDEX big4_waivers_member ON public.big4_waivers USING btree (member_id);
CREATE INDEX big4_waivers_granted_by_idx ON public.big4_waivers USING btree (granted_by);

-- public.bike_registrations  [RLS ON]
create table public.bike_registrations (
  bike_id uuid not null,
  rego text,
  rego_expiry date,
  constraint bike_registrations_bike_id_fkey FOREIGN KEY (bike_id) REFERENCES bikes(id) ON DELETE CASCADE,
  constraint bike_registrations_pkey PRIMARY KEY (bike_id)
);

-- public.bikes  [RLS ON]
create table public.bikes (
  id uuid not null default gen_random_uuid(),
  member_id uuid not null,
  make text not null,
  model text not null,
  year integer,
  nickname text,
  is_project boolean not null default false,
  created_at timestamp with time zone not null default now(),
  range_km integer,
  constraint bikes_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint bikes_pkey PRIMARY KEY (id),
  constraint bikes_range_km_check CHECK (((range_km >= 30) AND (range_km <= 1000))),
  constraint bikes_year_check CHECK (((year >= 1885) AND (year <= 2100)))
);
CREATE INDEX bikes_member_idx ON public.bikes USING btree (member_id);

-- public.brag_awards  [RLS ON]
create table public.brag_awards (
  id uuid not null default gen_random_uuid(),
  kind brag_kind not null,
  title text not null,
  year integer not null,
  nominations_close date not null,
  voting_close date not null,
  opened_by uuid,
  opened_at timestamp with time zone not null default now(),
  archived_at timestamp with time zone,
  archived_by uuid,
  constraint brag_awards_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint brag_awards_dates CHECK ((voting_close > nominations_close)),
  constraint brag_awards_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint brag_awards_pkey PRIMARY KEY (id),
  constraint brag_awards_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 60))),
  constraint brag_awards_year_check CHECK ((year >= 2019))
);
CREATE INDEX brag_awards_archived_by_idx ON public.brag_awards USING btree (archived_by);
CREATE INDEX brag_awards_opened_by_idx ON public.brag_awards USING btree (opened_by);

-- public.brag_nominations  [RLS ON]
create table public.brag_nominations (
  id uuid not null default gen_random_uuid(),
  award_id uuid not null,
  nominated_by uuid,
  ride_id uuid,
  title text,
  photo jsonb,
  story text,
  reason text,
  nominated_at timestamp with time zone not null default now(),
  withdrawn_at timestamp with time zone,
  withdrawn_by uuid,
  constraint brag_nominations_award_id_fkey FOREIGN KEY (award_id) REFERENCES brag_awards(id) ON DELETE CASCADE,
  constraint brag_nominations_nominated_by_fkey FOREIGN KEY (nominated_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint brag_nominations_photo_check CHECK (((photo IS NULL) OR (jsonb_typeof(photo) = 'object'::text))),
  constraint brag_nominations_pkey PRIMARY KEY (id),
  constraint brag_nominations_reason_check CHECK (((char_length(reason) >= 1) AND (char_length(reason) <= 300))),
  constraint brag_nominations_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE SET NULL,
  constraint brag_nominations_story_check CHECK (((char_length(story) >= 1) AND (char_length(story) <= 1000))),
  constraint brag_nominations_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 80))),
  constraint brag_nominations_withdrawn_by_fkey FOREIGN KEY (withdrawn_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX brag_nominations_award ON public.brag_nominations USING btree (award_id);
CREATE INDEX brag_nominations_nominated_by_idx ON public.brag_nominations USING btree (nominated_by);
CREATE INDEX brag_nominations_ride_id_idx ON public.brag_nominations USING btree (ride_id);
CREATE INDEX brag_nominations_withdrawn_by_idx ON public.brag_nominations USING btree (withdrawn_by);

-- public.brag_votes  [RLS ON]
create table public.brag_votes (
  award_id uuid not null,
  member_id uuid not null,
  nomination_id uuid not null,
  voted_at timestamp with time zone not null default now(),
  constraint brag_votes_award_id_fkey FOREIGN KEY (award_id) REFERENCES brag_awards(id) ON DELETE CASCADE,
  constraint brag_votes_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint brag_votes_nomination_id_fkey FOREIGN KEY (nomination_id) REFERENCES brag_nominations(id) ON DELETE CASCADE,
  constraint brag_votes_pkey PRIMARY KEY (award_id, member_id)
);
CREATE INDEX brag_votes_member_id_idx ON public.brag_votes USING btree (member_id);
CREATE INDEX brag_votes_nomination_id_idx ON public.brag_votes USING btree (nomination_id);

-- public.budgets  [RLS ON]
create table public.budgets (
  chapter_id uuid,
  fy integer not null,
  lines jsonb not null default '{}'::jsonb,
  approved_vote_id uuid,
  approved_at timestamp with time zone,
  approved_by uuid,
  updated_by uuid,
  updated_at timestamp with time zone not null default now(),
  id bigint not null,
  constraint budgets_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint budgets_approved_vote_id_fkey FOREIGN KEY (approved_vote_id) REFERENCES votes(id),
  constraint budgets_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint budgets_pkey PRIMARY KEY (id),
  constraint budgets_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX budgets_one ON public.budgets USING btree (COALESCE(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid), fy);
CREATE INDEX budgets_approved_by_idx ON public.budgets USING btree (approved_by);
CREATE INDEX budgets_approved_vote_id_idx ON public.budgets USING btree (approved_vote_id);
CREATE INDEX budgets_chapter_id_idx ON public.budgets USING btree (chapter_id);
CREATE INDEX budgets_updated_by_idx ON public.budgets USING btree (updated_by);

-- public.build_updates  [RLS ON]
create table public.build_updates (
  id uuid not null default gen_random_uuid(),
  bike_id uuid,
  author_id uuid not null,
  body text,
  photos jsonb not null default '[]'::jsonb,
  posted_at timestamp with time zone not null default now(),
  taken_down_at timestamp with time zone,
  taken_down_by uuid,
  constraint build_updates_author_id_fkey FOREIGN KEY (author_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint build_updates_bike_id_fkey FOREIGN KEY (bike_id) REFERENCES bikes(id) ON DELETE SET NULL,
  constraint build_updates_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 2000))),
  constraint build_updates_not_empty CHECK (((body IS NOT NULL) OR (jsonb_array_length(photos) > 0))),
  constraint build_updates_photos_check CHECK (((jsonb_typeof(photos) = 'array'::text) AND (jsonb_array_length(photos) <= 4))),
  constraint build_updates_pkey PRIMARY KEY (id),
  constraint build_updates_taken_down_by_fkey FOREIGN KEY (taken_down_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX build_updates_bike ON public.build_updates USING btree (bike_id, posted_at DESC);
CREATE INDEX build_updates_author_id_idx ON public.build_updates USING btree (author_id);
CREATE INDEX build_updates_taken_down_by_idx ON public.build_updates USING btree (taken_down_by);

-- public.bus_bookings  [RLS ON]
create table public.bus_bookings (
  id uuid not null default gen_random_uuid(),
  first_day date not null,
  last_day date not null,
  purpose bus_purpose not null,
  ride_id uuid,
  driver_id uuid,
  notes text,
  status bus_status not null,
  booked_by uuid,
  booked_at timestamp with time zone not null default now(),
  decided_by uuid,
  decided_at timestamp with time zone,
  decline_reason text,
  cancelled_by uuid,
  cancelled_at timestamp with time zone,
  changed_by uuid,
  changed_at timestamp with time zone,
  constraint bus_bookings_booked_by_fkey FOREIGN KEY (booked_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint bus_bookings_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint bus_bookings_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint bus_bookings_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint bus_bookings_decline_reason_check CHECK ((char_length(decline_reason) <= 300)),
  constraint bus_bookings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES members(id) ON DELETE SET NULL,
  constraint bus_bookings_in_order CHECK ((last_day >= first_day)),
  constraint bus_bookings_no_double_booking EXCLUDE USING gist (daterange(first_day, last_day, '[]'::text) WITH &&) WHERE ((status = 'approved'::bus_status)),
  constraint bus_bookings_notes_check CHECK ((char_length(notes) <= 500)),
  constraint bus_bookings_pkey PRIMARY KEY (id),
  constraint bus_bookings_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE SET NULL,
  constraint bus_bookings_two_weeks CHECK (((last_day - first_day) <= 13))
);
CREATE INDEX bus_bookings_no_double_booking ON public.bus_bookings USING gist (daterange(first_day, last_day, '[]'::text)) WHERE (status = 'approved'::bus_status);
CREATE INDEX bus_bookings_ride ON public.bus_bookings USING btree (ride_id);
CREATE INDEX bus_bookings_booked_by_idx ON public.bus_bookings USING btree (booked_by);
CREATE INDEX bus_bookings_cancelled_by_idx ON public.bus_bookings USING btree (cancelled_by);
CREATE INDEX bus_bookings_changed_by_idx ON public.bus_bookings USING btree (changed_by);
CREATE INDEX bus_bookings_decided_by_idx ON public.bus_bookings USING btree (decided_by);
CREATE INDEX bus_bookings_driver_id_idx ON public.bus_bookings USING btree (driver_id);

-- public.bus_costs  [RLS ON]
create table public.bus_costs (
  id uuid not null default gen_random_uuid(),
  spent_on date not null,
  kind bus_cost_kind not null,
  amount_cents integer not null,
  litres numeric(6,2),
  booking_id uuid,
  note text,
  logged_by uuid,
  logged_at timestamp with time zone not null default now(),
  struck_by uuid,
  struck_at timestamp with time zone,
  constraint bus_costs_amount_cents_check CHECK (((amount_cents >= 1) AND (amount_cents <= 10000000))),
  constraint bus_costs_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bus_bookings(id) ON DELETE SET NULL,
  constraint bus_costs_litres_check CHECK (((litres > (0)::numeric) AND (litres <= (1000)::numeric))),
  constraint bus_costs_litres_for_fuel CHECK (((litres IS NULL) OR (kind = 'fuel'::bus_cost_kind))),
  constraint bus_costs_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint bus_costs_note_check CHECK ((char_length(note) <= 200)),
  constraint bus_costs_pkey PRIMARY KEY (id),
  constraint bus_costs_struck_by_fkey FOREIGN KEY (struck_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX bus_costs_spent_on ON public.bus_costs USING btree (spent_on);
CREATE INDEX bus_costs_booking ON public.bus_costs USING btree (booking_id);
CREATE INDEX bus_costs_logged_by_idx ON public.bus_costs USING btree (logged_by);
CREATE INDEX bus_costs_struck_by_idx ON public.bus_costs USING btree (struck_by);

-- public.bus_key_handovers  [RLS ON]
create table public.bus_key_handovers (
  id uuid not null default gen_random_uuid(),
  to_id uuid,
  note text,
  logged_by uuid,
  logged_at timestamp with time zone not null default now(),
  constraint bus_key_handovers_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint bus_key_handovers_note_check CHECK ((char_length(note) <= 200)),
  constraint bus_key_handovers_pkey PRIMARY KEY (id),
  constraint bus_key_handovers_to_id_fkey FOREIGN KEY (to_id) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX bus_key_handovers_newest ON public.bus_key_handovers USING btree (logged_at DESC, id DESC);
CREATE INDEX bus_key_handovers_logged_by_idx ON public.bus_key_handovers USING btree (logged_by);
CREATE INDEX bus_key_handovers_to_id_idx ON public.bus_key_handovers USING btree (to_id);

-- public.bus_km  [RLS ON]
create table public.bus_km (
  id uuid not null default gen_random_uuid(),
  km integer not null,
  read_on date not null,
  booking_id uuid,
  note text,
  logged_by uuid,
  logged_at timestamp with time zone not null default now(),
  struck_by uuid,
  struck_at timestamp with time zone,
  constraint bus_km_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bus_bookings(id) ON DELETE SET NULL,
  constraint bus_km_km_check CHECK (((km >= 1) AND (km <= 2000000))),
  constraint bus_km_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint bus_km_note_check CHECK ((char_length(note) <= 200)),
  constraint bus_km_pkey PRIMARY KEY (id),
  constraint bus_km_struck_by_fkey FOREIGN KEY (struck_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX bus_km_read_on ON public.bus_km USING btree (read_on);
CREATE INDEX bus_km_booking ON public.bus_km USING btree (booking_id);
CREATE INDEX bus_km_logged_by_idx ON public.bus_km USING btree (logged_by);
CREATE INDEX bus_km_struck_by_idx ON public.bus_km USING btree (struck_by);

-- public.cash_floats  [RLS ON]
create table public.cash_floats (
  fy integer not null,
  amount_cents integer not null,
  set_by uuid,
  set_at timestamp with time zone not null default now(),
  constraint cash_floats_amount_cents_check CHECK ((amount_cents >= 0)),
  constraint cash_floats_pkey PRIMARY KEY (fy),
  constraint cash_floats_set_by_fkey FOREIGN KEY (set_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX cash_floats_set_by_idx ON public.cash_floats USING btree (set_by);

-- public.chapter_proposals  [RLS ON]
create table public.chapter_proposals (
  id uuid not null default gen_random_uuid(),
  name text not null,
  area text not null,
  state text not null,
  plan jsonb not null,
  founder_ids uuid[] not null,
  president_id uuid not null,
  saa_id uuid not null,
  status text not null default 'proposed'::text,
  proposed_by uuid,
  proposed_at timestamp with time zone not null default now(),
  vote_id uuid,
  decided_by uuid,
  decided_at timestamp with time zone,
  chapter_id uuid,
  constraint chapter_proposals_area_check CHECK (((char_length(area) >= 1) AND (char_length(area) <= 80))),
  constraint chapter_proposals_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint chapter_proposals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint chapter_proposals_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 40))),
  constraint chapter_proposals_pkey PRIMARY KEY (id),
  constraint chapter_proposals_president_id_fkey FOREIGN KEY (president_id) REFERENCES members(id),
  constraint chapter_proposals_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint chapter_proposals_saa_id_fkey FOREIGN KEY (saa_id) REFERENCES members(id),
  constraint chapter_proposals_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'not_approved'::text, 'withdrawn'::text]))),
  constraint chapter_proposals_vote_id_fkey FOREIGN KEY (vote_id) REFERENCES votes(id)
);
CREATE INDEX chapter_proposals_chapter_id_idx ON public.chapter_proposals USING btree (chapter_id);
CREATE INDEX chapter_proposals_decided_by_idx ON public.chapter_proposals USING btree (decided_by);
CREATE INDEX chapter_proposals_president_id_idx ON public.chapter_proposals USING btree (president_id);
CREATE INDEX chapter_proposals_proposed_by_idx ON public.chapter_proposals USING btree (proposed_by);
CREATE INDEX chapter_proposals_saa_id_idx ON public.chapter_proposals USING btree (saa_id);
CREATE INDEX chapter_proposals_vote_id_idx ON public.chapter_proposals USING btree (vote_id);

-- public.chapters  [RLS ON]
create table public.chapters (
  id uuid not null default gen_random_uuid(),
  slug text not null,
  name text not null,
  area text not null,
  state text not null default 'VIC'::text,
  created_at timestamp with time zone not null default now(),
  constraint chapters_pkey PRIMARY KEY (id),
  constraint chapters_slug_key UNIQUE (slug)
);
CREATE UNIQUE INDEX chapters_slug_key ON public.chapters USING btree (slug);

-- public.charges  [RLS ON]
create table public.charges (
  id uuid not null default gen_random_uuid(),
  member_id uuid not null,
  chapter_id uuid not null,
  fy integer not null,
  kind text not null,
  description text,
  amount_cents integer not null,
  due_on date not null,
  raised_by uuid,
  created_at timestamp with time zone not null default now(),
  waived_at timestamp with time zone,
  waived_by uuid,
  constraint charges_amount_cents_check CHECK ((amount_cents > 0)),
  constraint charges_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint charges_kind_check CHECK ((kind = ANY (ARRAY['annual'::text, 'continuation'::text, 'other'::text]))),
  constraint charges_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
  constraint charges_pkey PRIMARY KEY (id),
  constraint charges_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint charges_waived_by_fkey FOREIGN KEY (waived_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX charges_one_yearly ON public.charges USING btree (member_id, fy, kind) WHERE (kind = ANY (ARRAY['annual'::text, 'continuation'::text]));
CREATE INDEX charges_chapter ON public.charges USING btree (chapter_id, fy);
CREATE INDEX charges_raised_by_idx ON public.charges USING btree (raised_by);
CREATE INDEX charges_waived_by_idx ON public.charges USING btree (waived_by);

-- public.charity_rides  [RLS ON]
create table public.charity_rides (
  ride_id uuid not null,
  cause text not null,
  about text,
  closes_on date,
  places integer,
  jobs text[] not null default '{}'::text[],
  updated_by uuid,
  updated_at timestamp with time zone not null default now(),
  website boolean not null default false,
  constraint charity_rides_about_check CHECK ((char_length(about) <= 1000)),
  constraint charity_rides_cause_check CHECK (((char_length(cause) >= 1) AND (char_length(cause) <= 120))),
  constraint charity_rides_jobs_check CHECK ((cardinality(jobs) <= 8)),
  constraint charity_rides_pkey PRIMARY KEY (ride_id),
  constraint charity_rides_places_check CHECK (((places >= 1) AND (places <= 2000))),
  constraint charity_rides_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
  constraint charity_rides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX charity_rides_updated_by_idx ON public.charity_rides USING btree (updated_by);

-- public.charity_signups  [RLS ON]
create table public.charity_signups (
  ride_id uuid not null,
  member_id uuid not null,
  riding boolean not null default true,
  pillion boolean not null default false,
  guests integer not null default 0,
  guest_names text,
  job text,
  notes text,
  signed_at timestamp with time zone not null default now(),
  withdrawn_at timestamp with time zone,
  constraint charity_signups_check CHECK ((riding OR (job IS NOT NULL))),
  constraint charity_signups_check1 CHECK ((riding OR (NOT pillion))),
  constraint charity_signups_guest_names_check CHECK ((char_length(guest_names) <= 200)),
  constraint charity_signups_guests_check CHECK (((guests >= 0) AND (guests <= 10))),
  constraint charity_signups_job_check CHECK ((char_length(job) <= 40)),
  constraint charity_signups_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint charity_signups_notes_check CHECK ((char_length(notes) <= 200)),
  constraint charity_signups_pkey PRIMARY KEY (ride_id, member_id),
  constraint charity_signups_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES charity_rides(ride_id) ON DELETE CASCADE
);
CREATE INDEX charity_signups_member_id_idx ON public.charity_signups USING btree (member_id);

-- public.chat_reads  [RLS ON]
create table public.chat_reads (
  conversation_id uuid not null,
  member_id uuid not null,
  read_at timestamp with time zone not null default now(),
  constraint chat_reads_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  constraint chat_reads_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint chat_reads_pkey PRIMARY KEY (conversation_id, member_id)
);
CREATE INDEX chat_reads_member_id_idx ON public.chat_reads USING btree (member_id);

-- public.checkin_sessions  [RLS ON]
create table public.checkin_sessions (
  id uuid not null default gen_random_uuid(),
  kind text not null,
  chapter_id uuid,
  ride_id uuid,
  title text not null,
  held_on date not null,
  code text not null,
  opened_by uuid,
  opened_at timestamp with time zone not null default now(),
  closed_at timestamp with time zone,
  meeting_type text,
  constraint checkin_sessions_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint checkin_sessions_check CHECK (((kind = 'ride'::text) OR ((chapter_id IS NOT NULL) AND (ride_id IS NULL)))),
  constraint checkin_sessions_check1 CHECK (((kind = 'meeting'::text) OR (ride_id IS NOT NULL))),
  constraint checkin_sessions_code_key UNIQUE (code),
  constraint checkin_sessions_kind_check CHECK ((kind = ANY (ARRAY['ride'::text, 'meeting'::text]))),
  constraint checkin_sessions_meeting_type_check CHECK ((meeting_type = ANY (ARRAY['ordinary'::text, 'special'::text, 'event'::text]))),
  constraint checkin_sessions_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint checkin_sessions_pkey PRIMARY KEY (id),
  constraint checkin_sessions_ride_has_no_meeting_type CHECK (((kind = 'meeting'::text) OR (meeting_type IS NULL))),
  constraint checkin_sessions_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id),
  constraint checkin_sessions_ride_id_key UNIQUE (ride_id),
  constraint checkin_sessions_title_check CHECK ((length(TRIM(BOTH FROM title)) > 0))
);
CREATE UNIQUE INDEX checkin_sessions_ride_id_key ON public.checkin_sessions USING btree (ride_id);
CREATE UNIQUE INDEX checkin_sessions_code_key ON public.checkin_sessions USING btree (code);
CREATE INDEX checkin_sessions_held_on ON public.checkin_sessions USING btree (held_on);
CREATE INDEX checkin_sessions_chapter_id_idx ON public.checkin_sessions USING btree (chapter_id);
CREATE INDEX checkin_sessions_opened_by_idx ON public.checkin_sessions USING btree (opened_by);

-- public.club_history  [RLS ON]
create table public.club_history (
  id uuid not null default gen_random_uuid(),
  happened_on date not null,
  "precision" history_precision not null default 'day'::history_precision,
  title text not null,
  story text,
  added_by uuid,
  added_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  archived_at timestamp with time zone,
  archived_by uuid,
  constraint club_history_added_by_fkey FOREIGN KEY (added_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint club_history_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint club_history_pkey PRIMARY KEY (id),
  constraint club_history_story_check CHECK (((char_length(story) >= 1) AND (char_length(story) <= 1000))),
  constraint club_history_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 80)))
);
CREATE INDEX club_history_on ON public.club_history USING btree (happened_on);
CREATE INDEX club_history_added_by_idx ON public.club_history USING btree (added_by);
CREATE INDEX club_history_archived_by_idx ON public.club_history USING btree (archived_by);

-- public.club_honours  [RLS ON]
create table public.club_honours (
  id uuid not null default gen_random_uuid(),
  member_id uuid,
  name text,
  honour text not null,
  year integer not null,
  note text,
  added_by uuid,
  added_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  archived_at timestamp with time zone,
  archived_by uuid,
  constraint club_honours_added_by_fkey FOREIGN KEY (added_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint club_honours_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint club_honours_honour_check CHECK (((char_length(honour) >= 1) AND (char_length(honour) <= 60))),
  constraint club_honours_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL,
  constraint club_honours_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80))),
  constraint club_honours_note_check CHECK (((char_length(note) >= 1) AND (char_length(note) <= 300))),
  constraint club_honours_pkey PRIMARY KEY (id),
  constraint club_honours_year_check CHECK ((year >= 2019))
);
CREATE INDEX club_honours_added_by_idx ON public.club_honours USING btree (added_by);
CREATE INDEX club_honours_archived_by_idx ON public.club_honours USING btree (archived_by);
CREATE INDEX club_honours_member_id_idx ON public.club_honours USING btree (member_id);

-- public.club_invites  [RLS ON]
create table public.club_invites (
  id uuid not null default gen_random_uuid(),
  direction invite_direction not null,
  club_id uuid not null,
  chapter_id uuid,
  ride_id uuid,
  title text,
  event_on date,
  place text,
  details text,
  answer invite_answer not null default 'waiting'::invite_answer,
  calendar_label ride_category,
  bikes integer,
  note text,
  added_by uuid,
  added_at timestamp with time zone not null default now(),
  answered_by uuid,
  answered_at timestamp with time zone,
  archived_at timestamp with time zone,
  archived_by uuid,
  constraint club_invites_added_by_fkey FOREIGN KEY (added_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint club_invites_answered_by_fkey FOREIGN KEY (answered_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint club_invites_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint club_invites_bikes_check CHECK (((bikes >= 1) AND (bikes <= 500))),
  constraint club_invites_calendar_label_check CHECK ((calendar_label = ANY (ARRAY['supported'::ride_category, 'non_nuts'::ride_category]))),
  constraint club_invites_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint club_invites_check CHECK (((direction = 'out'::invite_direction) OR ((title IS NOT NULL) AND (event_on IS NOT NULL)))),
  constraint club_invites_check1 CHECK (((direction = 'in'::invite_direction) OR ((ride_id IS NOT NULL) AND (title IS NULL) AND (event_on IS NULL) AND (place IS NULL) AND (details IS NULL)))),
  constraint club_invites_check2 CHECK (((calendar_label IS NULL) OR ((direction = 'in'::invite_direction) AND (answer = 'yes'::invite_answer)))),
  constraint club_invites_check3 CHECK (((bikes IS NULL) OR ((direction = 'out'::invite_direction) AND (answer = 'yes'::invite_answer)))),
  constraint club_invites_club_id_fkey FOREIGN KEY (club_id) REFERENCES other_clubs(id),
  constraint club_invites_details_check CHECK (((char_length(details) >= 1) AND (char_length(details) <= 1000))),
  constraint club_invites_note_check CHECK (((char_length(note) >= 1) AND (char_length(note) <= 300))),
  constraint club_invites_pkey PRIMARY KEY (id),
  constraint club_invites_place_check CHECK (((char_length(place) >= 1) AND (char_length(place) <= 120))),
  constraint club_invites_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id),
  constraint club_invites_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 80)))
);
CREATE INDEX club_invites_ride ON public.club_invites USING btree (ride_id);
CREATE INDEX club_invites_club ON public.club_invites USING btree (club_id);
CREATE UNIQUE INDEX club_invites_once ON public.club_invites USING btree (ride_id, club_id) WHERE ((direction = 'out'::invite_direction) AND (archived_at IS NULL));
CREATE UNIQUE INDEX club_invites_one_event ON public.club_invites USING btree (ride_id) WHERE ((direction = 'in'::invite_direction) AND (archived_at IS NULL));
CREATE INDEX club_invites_added_by_idx ON public.club_invites USING btree (added_by);
CREATE INDEX club_invites_answered_by_idx ON public.club_invites USING btree (answered_by);
CREATE INDEX club_invites_archived_by_idx ON public.club_invites USING btree (archived_by);
CREATE INDEX club_invites_chapter_id_idx ON public.club_invites USING btree (chapter_id);

-- public.conduct_appeals  [RLS ON]
create table public.conduct_appeals (
  record_id uuid not null,
  lodged_on date not null,
  lodged_by uuid,
  grounds text not null,
  panel uuid[] not null default '{}'::uuid[],
  hearing_on date,
  outcome text,
  outcome_note text,
  decided_on date,
  decided_by uuid,
  withdrawn_on date,
  constraint conduct_appeals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint conduct_appeals_grounds_check CHECK (((char_length(grounds) >= 1) AND (char_length(grounds) <= 1000))),
  constraint conduct_appeals_lodged_by_fkey FOREIGN KEY (lodged_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint conduct_appeals_outcome_check CHECK ((outcome = ANY (ARRAY['confirmed'::text, 'varied'::text]))),
  constraint conduct_appeals_outcome_note_check CHECK ((char_length(outcome_note) <= 1000)),
  constraint conduct_appeals_pkey PRIMARY KEY (record_id),
  constraint conduct_appeals_record_id_fkey FOREIGN KEY (record_id) REFERENCES conduct_records(id) ON DELETE CASCADE
);
CREATE INDEX conduct_appeals_decided_by_idx ON public.conduct_appeals USING btree (decided_by);
CREATE INDEX conduct_appeals_lodged_by_idx ON public.conduct_appeals USING btree (lodged_by);

-- public.conduct_records  [RLS ON]
create table public.conduct_records (
  id uuid not null default gen_random_uuid(),
  member_id uuid not null,
  chapter_id uuid not null,
  kind text not null,
  summary text not null,
  rule text,
  decided_on date not null,
  notice_on date not null,
  suspended_until date,
  recorded_by uuid,
  recorded_at timestamp with time zone not null default now(),
  hold_until date,
  hold_reason text,
  constraint conduct_records_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint conduct_records_check CHECK ((notice_on >= decided_on)),
  constraint conduct_records_check1 CHECK (((kind = 'suspension'::text) = (suspended_until IS NOT NULL))),
  constraint conduct_records_hold_reason_check CHECK ((char_length(hold_reason) <= 300)),
  constraint conduct_records_kind_check CHECK ((kind = ANY (ARRAY['vest'::text, 'ride_safety'::text, 'attendance'::text, 'other'::text, 'reprimand'::text, 'suspension'::text, 'expulsion'::text]))),
  constraint conduct_records_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint conduct_records_pkey PRIMARY KEY (id),
  constraint conduct_records_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint conduct_records_rule_check CHECK ((char_length(rule) <= 200)),
  constraint conduct_records_summary_check CHECK (((char_length(summary) >= 1) AND (char_length(summary) <= 1000)))
);
CREATE INDEX conduct_records_chapter_id_idx ON public.conduct_records USING btree (chapter_id);
CREATE INDEX conduct_records_member_id_idx ON public.conduct_records USING btree (member_id);
CREATE INDEX conduct_records_recorded_by_idx ON public.conduct_records USING btree (recorded_by);

-- public.content_reports  [RLS ON]
create table public.content_reports (
  id uuid not null default gen_random_uuid(),
  kind text not null,
  target_id uuid not null,
  author_id uuid,
  reporter_id uuid not null,
  reason text,
  snapshot text not null default ''::text,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  resolved_by uuid,
  outcome report_outcome,
  constraint content_reports_author_id_fkey FOREIGN KEY (author_id) REFERENCES members(id) ON DELETE SET NULL,
  constraint content_reports_kind_check CHECK ((kind = ANY (ARRAY['listing'::text, 'build_update'::text, 'nomination'::text, 'mechanic'::text, 'profile'::text]))),
  constraint content_reports_pkey PRIMARY KEY (id),
  constraint content_reports_reason_check CHECK ((char_length(reason) <= 500)),
  constraint content_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint content_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX content_reports_one_open ON public.content_reports USING btree (kind, target_id, reporter_id) WHERE (resolved_at IS NULL);
CREATE INDEX content_reports_author_id_idx ON public.content_reports USING btree (author_id);
CREATE INDEX content_reports_reporter_id_idx ON public.content_reports USING btree (reporter_id);
CREATE INDEX content_reports_resolved_by_idx ON public.content_reports USING btree (resolved_by);

-- public.continuation_fees  [RLS ON]
create table public.continuation_fees (
  chapter_id uuid not null,
  fy integer not null,
  amount_cents integer not null,
  constraint continuation_fees_amount_cents_check CHECK ((amount_cents > 0)),
  constraint continuation_fees_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint continuation_fees_pkey PRIMARY KEY (chapter_id, fy)
);

-- public.contribution_decisions  [RLS ON]
create table public.contribution_decisions (
  contribution_id uuid not null,
  chapter_id uuid not null,
  yes boolean not null,
  vote_id uuid not null,
  recorded_by uuid,
  recorded_at timestamp with time zone not null default now(),
  constraint contribution_decisions_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint contribution_decisions_contribution_id_fkey FOREIGN KEY (contribution_id) REFERENCES national_contributions(id),
  constraint contribution_decisions_pkey PRIMARY KEY (contribution_id, chapter_id),
  constraint contribution_decisions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint contribution_decisions_vote_id_fkey FOREIGN KEY (vote_id) REFERENCES votes(id)
);
CREATE INDEX contribution_decisions_chapter_id_idx ON public.contribution_decisions USING btree (chapter_id);
CREATE INDEX contribution_decisions_recorded_by_idx ON public.contribution_decisions USING btree (recorded_by);
CREATE INDEX contribution_decisions_vote_id_idx ON public.contribution_decisions USING btree (vote_id);

-- public.conversation_members  [RLS ON]
create table public.conversation_members (
  conversation_id uuid not null,
  member_id uuid not null,
  constraint conversation_members_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  constraint conversation_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint conversation_members_pkey PRIMARY KEY (conversation_id, member_id)
);
CREATE INDEX conversation_members_member_id_idx ON public.conversation_members USING btree (member_id);

-- public.conversations  [RLS ON]
create table public.conversations (
  id uuid not null default gen_random_uuid(),
  kind chat_kind not null,
  chapter_id uuid,
  ride_id uuid,
  committee chat_committee,
  direct_key text,
  pinned_message_id uuid,
  created_at timestamp with time zone not null default now(),
  constraint conversations_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  constraint conversations_check CHECK (((kind = ANY (ARRAY['chapter'::chat_kind, 'board'::chat_kind])) = (chapter_id IS NOT NULL))),
  constraint conversations_check1 CHECK (((kind = 'ride'::chat_kind) = (ride_id IS NOT NULL))),
  constraint conversations_check2 CHECK (((kind = 'committee'::chat_kind) = (committee IS NOT NULL))),
  constraint conversations_check3 CHECK (((kind = 'direct'::chat_kind) = (direct_key IS NOT NULL))),
  constraint conversations_direct_key_key UNIQUE (direct_key),
  constraint conversations_pinned_fk FOREIGN KEY (pinned_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  constraint conversations_pkey PRIMARY KEY (id),
  constraint conversations_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX conversations_direct_key_key ON public.conversations USING btree (direct_key);
CREATE UNIQUE INDEX conversations_one_club_one_nec ON public.conversations USING btree (kind) WHERE (kind = ANY (ARRAY['club'::chat_kind, 'nec'::chat_kind]));
CREATE UNIQUE INDEX conversations_one_per_chapter ON public.conversations USING btree (chapter_id) WHERE (kind = 'chapter'::chat_kind);
CREATE UNIQUE INDEX conversations_one_big_table_per_chapter ON public.conversations USING btree (chapter_id) WHERE (kind = 'board'::chat_kind);
CREATE UNIQUE INDEX conversations_one_per_ride ON public.conversations USING btree (ride_id) WHERE (kind = 'ride'::chat_kind);
CREATE UNIQUE INDEX conversations_one_per_committee ON public.conversations USING btree (committee) WHERE (kind = 'committee'::chat_kind);
CREATE INDEX conversations_pinned_message_id_idx ON public.conversations USING btree (pinned_message_id);

-- public.crew_swaps  [RLS ON]
create table public.crew_swaps (
  id uuid not null default gen_random_uuid(),
  ride_id uuid not null,
  asked_by uuid not null,
  role crew_role not null,
  asked_to uuid not null,
  their_role crew_role,
  note text,
  state swap_state not null default 'asked'::swap_state,
  asked_at timestamp with time zone not null default now(),
  answered_at timestamp with time zone,
  constraint crew_swaps_asked_by_fkey FOREIGN KEY (asked_by) REFERENCES members(id) ON DELETE CASCADE,
  constraint crew_swaps_asked_to_fkey FOREIGN KEY (asked_to) REFERENCES members(id) ON DELETE CASCADE,
  constraint crew_swaps_note_check CHECK ((char_length(note) <= 200)),
  constraint crew_swaps_pkey PRIMARY KEY (id),
  constraint crew_swaps_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
);
CREATE INDEX crew_swaps_ride ON public.crew_swaps USING btree (ride_id);
CREATE UNIQUE INDEX crew_swaps_one_open ON public.crew_swaps USING btree (ride_id, asked_by) WHERE (state = 'asked'::swap_state);
CREATE INDEX crew_swaps_asked_by_idx ON public.crew_swaps USING btree (asked_by);
CREATE INDEX crew_swaps_asked_to_idx ON public.crew_swaps USING btree (asked_to);

-- public.document_signoffs  [RLS ON]
create table public.document_signoffs (
  version_id uuid not null,
  member_id uuid not null,
  signed_at timestamp with time zone not null default now(),
  constraint document_signoffs_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint document_signoffs_pkey PRIMARY KEY (version_id, member_id),
  constraint document_signoffs_version_id_fkey FOREIGN KEY (version_id) REFERENCES document_versions(id)
);
CREATE INDEX document_signoffs_member_id_idx ON public.document_signoffs USING btree (member_id);

-- public.document_versions  [RLS ON]
create table public.document_versions (
  id uuid not null default gen_random_uuid(),
  document_id uuid not null,
  number integer not null,
  label text not null,
  body text not null,
  what_changed text not null default ''::text,
  fresh_sign_off boolean not null default true,
  approving_body text,
  approved_on date,
  commences_on date,
  published_by uuid,
  published_at timestamp with time zone not null default now(),
  constraint document_versions_approving_body_check CHECK ((approving_body = ANY (ARRAY['association_general_meeting'::text, 'association_committee'::text, 'full_members'::text, 'nec'::text, 'chapter_board'::text]))),
  constraint document_versions_check CHECK ((((approving_body IS NULL) = (approved_on IS NULL)) AND ((approved_on IS NULL) = (commences_on IS NULL)))),
  constraint document_versions_check1 CHECK ((commences_on >= approved_on)),
  constraint document_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id),
  constraint document_versions_document_id_number_key UNIQUE (document_id, number),
  constraint document_versions_number_check CHECK ((number >= 1)),
  constraint document_versions_pkey PRIMARY KEY (id),
  constraint document_versions_published_by_fkey FOREIGN KEY (published_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX document_versions_document_id_number_key ON public.document_versions USING btree (document_id, number);
CREATE INDEX document_versions_published_by_idx ON public.document_versions USING btree (published_by);

-- public.documents  [RLS ON]
create table public.documents (
  id uuid not null default gen_random_uuid(),
  chapter_id uuid,
  kind text not null,
  title text not null,
  asks_sign_off boolean not null default false,
  review_months integer,
  reviewed_on date,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  constraint documents_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint documents_check CHECK (((kind = ANY (ARRAY['policy'::text, 'procedure'::text])) OR (chapter_id IS NULL))),
  constraint documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint documents_kind_check CHECK ((kind = ANY (ARRAY['registered_rules'::text, 'constitution'::text, 'policy'::text, 'procedure'::text]))),
  constraint documents_pkey PRIMARY KEY (id),
  constraint documents_review_months_check CHECK (((review_months >= 1) AND (review_months <= 60)))
);
CREATE UNIQUE INDEX documents_one_of_each ON public.documents USING btree (kind) WHERE (kind = ANY (ARRAY['registered_rules'::text, 'constitution'::text]));
CREATE INDEX documents_chapter_id_idx ON public.documents USING btree (chapter_id);
CREATE INDEX documents_created_by_idx ON public.documents USING btree (created_by);

-- public.emergency_contacts  [RLS ON]
create table public.emergency_contacts (
  id uuid not null default gen_random_uuid(),
  member_id uuid not null,
  name text not null,
  relationship text not null,
  phone text not null,
  created_at timestamp with time zone not null default now(),
  constraint emergency_contacts_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint emergency_contacts_pkey PRIMARY KEY (id)
);
CREATE INDEX emergency_contacts_member_idx ON public.emergency_contacts USING btree (member_id);

-- public.fee_rates  [RLS ON]
create table public.fee_rates (
  chapter_id uuid not null,
  fy integer not null,
  status member_status not null,
  amount_cents integer not null,
  due_on date not null,
  constraint fee_rates_amount_cents_check CHECK ((amount_cents > 0)),
  constraint fee_rates_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint fee_rates_pkey PRIMARY KEY (chapter_id, fy, status),
  constraint fee_rates_status_check CHECK ((status = ANY (ARRAY['full'::member_status, 'nomad'::member_status, 'fng'::member_status, 'supporter'::member_status, 'family'::member_status])))
);

-- public.fund_openings  [RLS ON]
create table public.fund_openings (
  chapter_id uuid,
  fy integer not null,
  amount_cents integer not null,
  set_by uuid,
  set_at timestamp with time zone not null default now(),
  id bigint not null,
  constraint fund_openings_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint fund_openings_pkey PRIMARY KEY (id),
  constraint fund_openings_set_by_fkey FOREIGN KEY (set_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX fund_openings_one ON public.fund_openings USING btree (COALESCE(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid), fy);
CREATE INDEX fund_openings_chapter_id_idx ON public.fund_openings USING btree (chapter_id);
CREATE INDEX fund_openings_set_by_idx ON public.fund_openings USING btree (set_by);

-- public.hub_registrations  [RLS ON]
create table public.hub_registrations (
  ride_id uuid not null,
  member_id uuid not null,
  staying hub_staying not null,
  pillion boolean not null default false,
  share_with text,
  notes text,
  registered_at timestamp with time zone not null default now(),
  withdrawn_at timestamp with time zone,
  constraint hub_registrations_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint hub_registrations_notes_check CHECK ((char_length(notes) <= 200)),
  constraint hub_registrations_pkey PRIMARY KEY (ride_id, member_id),
  constraint hub_registrations_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES ride_hubs(ride_id) ON DELETE CASCADE,
  constraint hub_registrations_share_with_check CHECK ((char_length(share_with) <= 80))
);
CREATE INDEX hub_registrations_member_id_idx ON public.hub_registrations USING btree (member_id);

-- public.ledger_approvals  [RLS ON]
create table public.ledger_approvals (
  entry_id uuid not null,
  member_id uuid not null,
  approved_at timestamp with time zone not null default now(),
  constraint ledger_approvals_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES ledger_entries(id),
  constraint ledger_approvals_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
  constraint ledger_approvals_pkey PRIMARY KEY (entry_id, member_id)
);
CREATE INDEX ledger_approvals_member_id_idx ON public.ledger_approvals USING btree (member_id);

-- public.ledger_codes  [RLS ON]
create table public.ledger_codes (
  code text not null,
  direction text not null,
  label text not null,
  constraint ledger_codes_direction_check CHECK ((direction = ANY (ARRAY['credit'::text, 'debit'::text]))),
  constraint ledger_codes_pkey PRIMARY KEY (code)
);

-- public.ledger_entries  [RLS ON]
create table public.ledger_entries (
  id uuid not null default gen_random_uuid(),
  chapter_id uuid,
  code text not null,
  description text not null,
  amount_cents integer not null,
  received_on date,
  entry_on date,
  payee_member_id uuid,
  payee_name text,
  payment_id uuid,
  state text not null,
  recorded_by uuid,
  recorded_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  void_reason text,
  voided_by uuid,
  voided_at timestamp with time zone,
  constraint ledger_entries_amount_cents_check CHECK ((amount_cents > 0)),
  constraint ledger_entries_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint ledger_entries_check CHECK ((((state = 'paid'::text) = (entry_on IS NOT NULL)) OR (state = 'void'::text))),
  constraint ledger_entries_code_fkey FOREIGN KEY (code) REFERENCES ledger_codes(code),
  constraint ledger_entries_payee_member_id_fkey FOREIGN KEY (payee_member_id) REFERENCES members(id) ON DELETE RESTRICT,
  constraint ledger_entries_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  constraint ledger_entries_payment_id_key UNIQUE (payment_id),
  constraint ledger_entries_pkey PRIMARY KEY (id),
  constraint ledger_entries_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint ledger_entries_state_check CHECK ((state = ANY (ARRAY['awaiting'::text, 'approved'::text, 'paid'::text, 'void'::text]))),
  constraint ledger_entries_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX ledger_entries_payment_id_key ON public.ledger_entries USING btree (payment_id);
CREATE INDEX ledger_entries_fund ON public.ledger_entries USING btree (chapter_id, entry_on);
CREATE INDEX ledger_entries_code_idx ON public.ledger_entries USING btree (code);
CREATE INDEX ledger_entries_payee_member_id_idx ON public.ledger_entries USING btree (payee_member_id);
CREATE INDEX ledger_entries_recorded_by_idx ON public.ledger_entries USING btree (recorded_by);
CREATE INDEX ledger_entries_voided_by_idx ON public.ledger_entries USING btree (voided_by);

-- public.listings  [RLS ON]
create table public.listings (
  id uuid not null default gen_random_uuid(),
  seller_id uuid not null,
  kind listing_kind not null,
  title text not null,
  price_dollars integer,
  details text,
  photos jsonb not null default '[]'::jsonb,
  listed_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  sold_at timestamp with time zone,
  taken_down_at timestamp with time zone,
  taken_down_by uuid,
  constraint listings_details_check CHECK ((char_length(details) <= 1000)),
  constraint listings_photos_check CHECK (((jsonb_typeof(photos) = 'array'::text) AND (jsonb_array_length(photos) <= 6))),
  constraint listings_pkey PRIMARY KEY (id),
  constraint listings_price_dollars_check CHECK (((price_dollars >= 1) AND (price_dollars <= 100000))),
  constraint listings_price_on_sales CHECK (((kind = 'sell'::listing_kind) = (price_dollars IS NOT NULL))),
  constraint listings_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint listings_taken_down_by_fkey FOREIGN KEY (taken_down_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint listings_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 80)))
);
CREATE INDEX listings_seller ON public.listings USING btree (seller_id);
CREATE INDEX listings_taken_down_by_idx ON public.listings USING btree (taken_down_by);

-- public.live_riders  [RLS ON]
create table public.live_riders (
  ride_id uuid not null,
  member_id uuid not null,
  lat double precision,
  lng double precision,
  accuracy_m real,
  heading real,
  speed_kmh real,
  updated_at timestamp with time zone,
  started_at timestamp with time zone not null default now(),
  stops_at timestamp with time zone not null,
  constraint live_riders_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint live_riders_pkey PRIMARY KEY (ride_id, member_id),
  constraint live_riders_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
);
CREATE INDEX live_riders_member_id_idx ON public.live_riders USING btree (member_id);

-- public.mechanic_vouches  [RLS ON]
create table public.mechanic_vouches (
  mechanic_id uuid not null,
  member_id uuid not null,
  vouched boolean not null,
  updated_at timestamp with time zone not null default now(),
  constraint mechanic_vouches_mechanic_id_fkey FOREIGN KEY (mechanic_id) REFERENCES mechanics(id) ON DELETE CASCADE,
  constraint mechanic_vouches_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint mechanic_vouches_pkey PRIMARY KEY (mechanic_id, member_id)
);
CREATE INDEX mechanic_vouches_member_id_idx ON public.mechanic_vouches USING btree (member_id);

-- public.mechanics  [RLS ON]
create table public.mechanics (
  id uuid not null default gen_random_uuid(),
  name text not null,
  suburb text,
  phone text,
  website text,
  speciality text,
  notes text,
  added_by uuid,
  added_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  archived_at timestamp with time zone,
  archived_by uuid,
  constraint mechanics_added_by_fkey FOREIGN KEY (added_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint mechanics_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint mechanics_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80))),
  constraint mechanics_notes_check CHECK ((char_length(notes) <= 500)),
  constraint mechanics_phone_check CHECK ((char_length(phone) <= 30)),
  constraint mechanics_pkey PRIMARY KEY (id),
  constraint mechanics_speciality_check CHECK ((char_length(speciality) <= 80)),
  constraint mechanics_suburb_check CHECK ((char_length(suburb) <= 60)),
  constraint mechanics_website_check CHECK (((char_length(website) <= 200) AND (website ~* '^https?://'::text)))
);
CREATE INDEX mechanics_added_by_idx ON public.mechanics USING btree (added_by);
CREATE INDEX mechanics_archived_by_idx ON public.mechanics USING btree (archived_by);

-- public.meetings  [RLS ON]
create table public.meetings (
  id uuid not null default gen_random_uuid(),
  chapter_id uuid,
  kind meeting_kind not null,
  title text not null,
  starts_at timestamp with time zone not null,
  location text,
  agenda jsonb not null default '[]'::jsonb,
  minutes text,
  minutes_approved_at timestamp with time zone,
  minutes_approved_by uuid,
  cancelled_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  minutes_shared_at timestamp with time zone,
  constraint meetings_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint meetings_created_by_fkey FOREIGN KEY (created_by) REFERENCES members(id),
  constraint meetings_minutes_approved_by_fkey FOREIGN KEY (minutes_approved_by) REFERENCES members(id),
  constraint meetings_pkey PRIMARY KEY (id)
);
CREATE INDEX meetings_starts_at ON public.meetings USING btree (starts_at);
CREATE INDEX meetings_chapter_id_idx ON public.meetings USING btree (chapter_id);
CREATE INDEX meetings_created_by_idx ON public.meetings USING btree (created_by);
CREATE INDEX meetings_minutes_approved_by_idx ON public.meetings USING btree (minutes_approved_by);

-- public.member_birthdays  [RLS ON]
create table public.member_birthdays (
  member_id uuid not null,
  month smallint,
  day smallint,
  set_at timestamp with time zone not null default now(),
  constraint member_birthdays_both_or_neither CHECK (((month IS NULL) = (day IS NULL))),
  constraint member_birthdays_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint member_birthdays_pkey PRIMARY KEY (member_id),
  constraint member_birthdays_real_day CHECK (((month IS NULL) OR (((month >= 1) AND (month <= 12)) AND ((day >= 1) AND (day <=
CASE
    WHEN (month = 2) THEN 29
    WHEN (month = ANY (ARRAY[4, 6, 9, 11])) THEN 30
    ELSE 31
END)))))
);

-- public.member_blocks  [RLS ON]
create table public.member_blocks (
  blocker_id uuid not null,
  blocked_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint member_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint member_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint member_blocks_check CHECK ((blocker_id <> blocked_id)),
  constraint member_blocks_pkey PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX member_blocks_blocked_id_idx ON public.member_blocks USING btree (blocked_id);

-- public.member_decisions  [RLS ON]
create table public.member_decisions (
  id uuid not null default gen_random_uuid(),
  member_id uuid not null,
  kind text not null,
  at_months integer,
  outcome text not null,
  status member_status,
  votes_for integer,
  votes_against integer,
  votes_abstained integer,
  note text,
  decided_on date not null,
  recorded_by uuid,
  created_at timestamp with time zone not null default now(),
  constraint member_decisions_at_months_check CHECK (((at_months IS NULL) OR (at_months >= 6))),
  constraint member_decisions_check CHECK (((kind = 'fng_review'::text) = (at_months IS NOT NULL))),
  constraint member_decisions_kind_check CHECK ((kind = ANY (ARRAY['application'::text, 'fng_review'::text]))),
  constraint member_decisions_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint member_decisions_outcome_check CHECK ((outcome = ANY (ARRAY['approved'::text, 'declined'::text, 'continue'::text, 'patch'::text, 'not_continuing'::text]))),
  constraint member_decisions_pkey PRIMARY KEY (id),
  constraint member_decisions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint member_decisions_votes_abstained_check CHECK ((votes_abstained >= 0)),
  constraint member_decisions_votes_against_check CHECK ((votes_against >= 0)),
  constraint member_decisions_votes_for_check CHECK ((votes_for >= 0))
);
CREATE UNIQUE INDEX member_decisions_one_per_slot ON public.member_decisions USING btree (member_id, at_months) WHERE (kind = 'fng_review'::text);
CREATE INDEX member_decisions_recorded_by_idx ON public.member_decisions USING btree (recorded_by);

-- public.member_private  [RLS ON]
create table public.member_private (
  member_id uuid not null,
  email text,
  phone text,
  licence_class licence_class,
  licence_expiry date,
  first_aid_expiry date,
  introduced_by text,
  application_note text,
  updated_at timestamp with time zone not null default now(),
  street text,
  suburb text,
  state text,
  postcode text,
  constraint member_private_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint member_private_pkey PRIMARY KEY (member_id),
  constraint member_private_postcode_check CHECK ((postcode ~ '^\d{4}$'::text)),
  constraint member_private_state_check CHECK ((state = ANY (ARRAY['ACT'::text, 'NSW'::text, 'NT'::text, 'QLD'::text, 'SA'::text, 'TAS'::text, 'VIC'::text, 'WA'::text]))),
  constraint member_private_street_check CHECK (((char_length(street) >= 1) AND (char_length(street) <= 120))),
  constraint member_private_suburb_check CHECK (((char_length(suburb) >= 1) AND (char_length(suburb) <= 60)))
);

-- public.member_skills  [RLS ON]
create table public.member_skills (
  member_id uuid not null,
  skills help_skill[] not null default '{}'::help_skill[],
  updated_at timestamp with time zone not null default now(),
  constraint member_skills_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint member_skills_pkey PRIMARY KEY (member_id)
);

-- public.members  [RLS ON]
create table public.members (
  id uuid not null,
  chapter_id uuid not null,
  full_name text not null,
  road_name text,
  status member_status not null default 'introduced'::member_status,
  approval approval_state not null default 'pending'::approval_state,
  joined_on date,
  patched_on date,
  fng_started_on date,
  bio text,
  share_phone boolean not null default false,
  applied_on date not null default ((now() AT TIME ZONE 'Australia/Melbourne'::text))::date,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  on_hiatus boolean not null default false,
  account_deleted_on date,
  posting_rules_accepted_on date,
  constraint members_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint members_full_name_check CHECK ((length(TRIM(BOTH FROM full_name)) > 0)),
  constraint members_pkey PRIMARY KEY (id)
);
CREATE INDEX members_chapter_idx ON public.members USING btree (chapter_id);

-- public.merch_items  [RLS ON]
create table public.merch_items (
  id uuid not null default gen_random_uuid(),
  chapter_id uuid,
  name text not null,
  details text,
  sizes text[] not null default '{}'::text[],
  price_cents integer not null,
  patched_only boolean not null default false,
  status text not null default 'proposed'::text,
  proposed_by uuid,
  proposed_at timestamp with time zone not null default now(),
  decided_by uuid,
  decided_at timestamp with time zone,
  decline_reason text,
  constraint merch_items_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint merch_items_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint merch_items_decline_reason_check CHECK ((char_length(decline_reason) <= 300)),
  constraint merch_items_details_check CHECK ((char_length(details) <= 500)),
  constraint merch_items_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80))),
  constraint merch_items_pkey PRIMARY KEY (id),
  constraint merch_items_price_cents_check CHECK (((price_cents >= 1) AND (price_cents <= 100000))),
  constraint merch_items_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint merch_items_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'on_sale'::text, 'declined'::text, 'closed'::text])))
);
CREATE INDEX merch_items_chapter_id_idx ON public.merch_items USING btree (chapter_id);
CREATE INDEX merch_items_decided_by_idx ON public.merch_items USING btree (decided_by);
CREATE INDEX merch_items_proposed_by_idx ON public.merch_items USING btree (proposed_by);

-- public.merch_orders  [RLS ON]
create table public.merch_orders (
  id uuid not null default gen_random_uuid(),
  item_id uuid not null,
  member_id uuid not null,
  size text,
  qty integer not null,
  unit_cents integer not null,
  note text,
  status text not null default 'waiting'::text,
  ordered_at timestamp with time zone not null default now(),
  decided_by uuid,
  decided_at timestamp with time zone,
  decline_reason text,
  paid_on date,
  ledger_entry_id uuid,
  handed_over_on date,
  constraint merch_orders_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint merch_orders_decline_reason_check CHECK ((char_length(decline_reason) <= 300)),
  constraint merch_orders_item_id_fkey FOREIGN KEY (item_id) REFERENCES merch_items(id),
  constraint merch_orders_ledger_entry_id_fkey FOREIGN KEY (ledger_entry_id) REFERENCES ledger_entries(id),
  constraint merch_orders_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
  constraint merch_orders_note_check CHECK ((char_length(note) <= 300)),
  constraint merch_orders_pkey PRIMARY KEY (id),
  constraint merch_orders_qty_check CHECK (((qty >= 1) AND (qty <= 10))),
  constraint merch_orders_status_check CHECK ((status = ANY (ARRAY['waiting'::text, 'approved'::text, 'paid'::text, 'handed_over'::text, 'declined'::text, 'cancelled'::text]))),
  constraint merch_orders_unit_cents_check CHECK ((unit_cents > 0))
);
CREATE INDEX merch_orders_decided_by_idx ON public.merch_orders USING btree (decided_by);
CREATE INDEX merch_orders_item_id_idx ON public.merch_orders USING btree (item_id);
CREATE INDEX merch_orders_ledger_entry_id_idx ON public.merch_orders USING btree (ledger_entry_id);
CREATE INDEX merch_orders_member_id_idx ON public.merch_orders USING btree (member_id);

-- public.message_media  [RLS ON]
create table public.message_media (
  id uuid not null default gen_random_uuid(),
  message_id uuid not null,
  conversation_id uuid not null,
  kind chat_media_kind not null,
  path text not null,
  poster_path text,
  width integer not null default 0,
  height integer not null default 0,
  duration_ms integer,
  "position" integer not null default 0,
  constraint message_media_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  constraint message_media_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  constraint message_media_pkey PRIMARY KEY (id)
);
CREATE INDEX message_media_by_message ON public.message_media USING btree (message_id);
CREATE UNIQUE INDEX message_media_path_once ON public.message_media USING btree (path) WHERE (kind <> 'gif'::chat_media_kind);
CREATE UNIQUE INDEX message_media_poster_once ON public.message_media USING btree (poster_path) WHERE (poster_path IS NOT NULL);
CREATE INDEX message_media_conversation_id_idx ON public.message_media USING btree (conversation_id);

-- public.message_reactions  [RLS ON]
create table public.message_reactions (
  message_id uuid not null,
  member_id uuid not null,
  emoji text not null,
  created_at timestamp with time zone not null default now(),
  constraint message_reactions_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  constraint message_reactions_pkey PRIMARY KEY (message_id, member_id, emoji)
);
CREATE INDEX message_reactions_member_id_idx ON public.message_reactions USING btree (member_id);

-- public.message_reports  [RLS ON]
create table public.message_reports (
  id uuid not null default gen_random_uuid(),
  message_id uuid not null,
  reporter_id uuid not null,
  reason text,
  body text,
  media_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  resolved_by uuid,
  outcome report_outcome,
  constraint message_reports_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  constraint message_reports_message_id_reporter_id_key UNIQUE (message_id, reporter_id),
  constraint message_reports_pkey PRIMARY KEY (id),
  constraint message_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint message_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX message_reports_message_id_reporter_id_key ON public.message_reports USING btree (message_id, reporter_id);
CREATE INDEX message_reports_reporter_id_idx ON public.message_reports USING btree (reporter_id);
CREATE INDEX message_reports_resolved_by_idx ON public.message_reports USING btree (resolved_by);

-- public.messages  [RLS ON]
create table public.messages (
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  author_id uuid not null,
  body text,
  reply_to_id uuid,
  created_at timestamp with time zone not null default clock_timestamp(),
  updated_at timestamp with time zone not null default clock_timestamp(),
  removed_at timestamp with time zone,
  removed_by uuid,
  constraint messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  constraint messages_pkey PRIMARY KEY (id),
  constraint messages_push TRIGGER DEFERRABLE INITIALLY DEFERRED,
  constraint messages_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL
);
CREATE INDEX messages_by_chat ON public.messages USING btree (conversation_id, created_at DESC);
CREATE INDEX messages_author_id_idx ON public.messages USING btree (author_id);
CREATE INDEX messages_removed_by_idx ON public.messages USING btree (removed_by);
CREATE INDEX messages_reply_to_id_idx ON public.messages USING btree (reply_to_id);

-- public.national_contributions  [RLS ON]
create table public.national_contributions (
  id uuid not null default gen_random_uuid(),
  title text not null,
  purpose text not null,
  total_cents integer not null,
  status text not null default 'proposed'::text,
  proposed_by uuid,
  proposed_at timestamp with time zone not null default now(),
  settled_at timestamp with time zone,
  shares jsonb not null,
  constraint national_contributions_pkey PRIMARY KEY (id),
  constraint national_contributions_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint national_contributions_purpose_check CHECK (((char_length(purpose) >= 1) AND (char_length(purpose) <= 1000))),
  constraint national_contributions_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'not_approved'::text, 'withdrawn'::text]))),
  constraint national_contributions_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 80))),
  constraint national_contributions_total_cents_check CHECK (((total_cents >= 100) AND (total_cents <= 10000000)))
);
CREATE INDEX national_contributions_proposed_by_idx ON public.national_contributions USING btree (proposed_by);

-- public.notification_prefs  [RLS ON]
create table public.notification_prefs (
  member_id uuid not null,
  ride_reminders boolean not null default true,
  ride_changes boolean not null default true,
  new_rides boolean not null default false,
  approvals boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  rev_sound boolean not null default true,
  chat_messages boolean not null default true,
  constraint notification_prefs_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint notification_prefs_pkey PRIMARY KEY (member_id)
);

-- public.other_clubs  [RLS ON]
create table public.other_clubs (
  id uuid not null default gen_random_uuid(),
  name text not null,
  town text,
  contact text,
  note text,
  added_by uuid,
  added_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  archived_at timestamp with time zone,
  archived_by uuid,
  constraint other_clubs_added_by_fkey FOREIGN KEY (added_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint other_clubs_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint other_clubs_contact_check CHECK (((char_length(contact) >= 1) AND (char_length(contact) <= 200))),
  constraint other_clubs_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80))),
  constraint other_clubs_note_check CHECK (((char_length(note) >= 1) AND (char_length(note) <= 300))),
  constraint other_clubs_pkey PRIMARY KEY (id),
  constraint other_clubs_town_check CHECK (((char_length(town) >= 1) AND (char_length(town) <= 60)))
);
CREATE UNIQUE INDEX other_clubs_name ON public.other_clubs USING btree (lower(name)) WHERE (archived_at IS NULL);
CREATE INDEX other_clubs_added_by_idx ON public.other_clubs USING btree (added_by);
CREATE INDEX other_clubs_archived_by_idx ON public.other_clubs USING btree (archived_by);

-- public.payment_details  [RLS ON]
create table public.payment_details (
  chapter_id uuid not null,
  payid text,
  payid_name text,
  bsb text,
  account_no text,
  updated_at timestamp with time zone not null default now(),
  constraint payment_details_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint payment_details_pkey PRIMARY KEY (chapter_id)
);

-- public.payments  [RLS ON]
create table public.payments (
  id uuid not null default gen_random_uuid(),
  charge_id uuid not null,
  amount_cents integer not null,
  paid_on date not null,
  method text not null,
  reference text,
  state text not null default 'claimed'::text,
  claimed_by uuid,
  decided_by uuid,
  decided_at timestamp with time zone,
  receipt_no text,
  created_at timestamp with time zone not null default now(),
  constraint payments_amount_cents_check CHECK ((amount_cents > 0)),
  constraint payments_charge_id_fkey FOREIGN KEY (charge_id) REFERENCES charges(id) ON DELETE RESTRICT,
  constraint payments_check CHECK (((state = 'confirmed'::text) = (receipt_no IS NOT NULL))),
  constraint payments_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint payments_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint payments_method_check CHECK ((method = ANY (ARRAY['payid'::text, 'bank'::text, 'cash'::text, 'card'::text]))),
  constraint payments_pkey PRIMARY KEY (id),
  constraint payments_receipt_no_key UNIQUE (receipt_no),
  constraint payments_state_check CHECK ((state = ANY (ARRAY['claimed'::text, 'confirmed'::text, 'rejected'::text])))
);
CREATE UNIQUE INDEX payments_receipt_no_key ON public.payments USING btree (receipt_no);
CREATE INDEX payments_charge ON public.payments USING btree (charge_id);
CREATE INDEX payments_claimed_by_idx ON public.payments USING btree (claimed_by);
CREATE INDEX payments_decided_by_idx ON public.payments USING btree (decided_by);

-- public.positions  [RLS ON]
create table public.positions (
  id uuid not null default gen_random_uuid(),
  member_id uuid not null,
  chapter_id uuid,
  role position_role not null,
  started_on date not null default ((now() AT TIME ZONE 'Australia/Melbourne'::text))::date,
  ended_on date,
  appointed_by uuid,
  ended_by uuid,
  constraint ends_after_start CHECK (((ended_on IS NULL) OR (ended_on >= started_on))),
  constraint national_roles_have_no_chapter CHECK (((role = ANY (ARRAY['nec_chair'::position_role, 'nec_secretary'::position_role, 'nec_auditor'::position_role, 'founder'::position_role])) = (chapter_id IS NULL))),
  constraint positions_appointed_by_fkey FOREIGN KEY (appointed_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint positions_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint positions_ended_by_fkey FOREIGN KEY (ended_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint positions_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint positions_pkey PRIMARY KEY (id)
);
CREATE INDEX positions_member_idx ON public.positions USING btree (member_id) WHERE (ended_on IS NULL);
CREATE UNIQUE INDEX one_holder_per_board_seat ON public.positions USING btree (chapter_id, role) WHERE ((ended_on IS NULL) AND (role = ANY (ARRAY['president'::position_role, 'vice_president'::position_role, 'secretary'::position_role, 'treasurer'::position_role, 'sergeant_at_arms'::position_role, 'road_captain'::position_role])));
CREATE UNIQUE INDEX one_holder_per_national_role ON public.positions USING btree (role) WHERE ((ended_on IS NULL) AND (chapter_id IS NULL));
CREATE UNIQUE INDEX one_open_role_per_member ON public.positions USING btree (member_id, chapter_id, role) WHERE (ended_on IS NULL);
CREATE INDEX positions_appointed_by_idx ON public.positions USING btree (appointed_by);
CREATE INDEX positions_ended_by_idx ON public.positions USING btree (ended_by);

-- public.push_devices  [RLS ON]
create table public.push_devices (
  token text not null,
  member_id uuid not null,
  platform text not null,
  updated_at timestamp with time zone not null default now(),
  constraint push_devices_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint push_devices_pkey PRIMARY KEY (token),
  constraint push_devices_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])))
);
CREATE INDEX push_devices_member ON public.push_devices USING btree (member_id);
