-- Rustnuts app: LIVE database export, taken 2 Nov 2026 from the production Supabase project.
-- Structure and code only. No member data, no secret values. Read-only reference for auditors.
-- Tables in the public and private schemas, with columns, constraints, indexes and whether row-level security is on.
-- Part 2 of 2.


-- public.ride_alerts  [RLS ON]
create table public.ride_alerts (
  id uuid not null default gen_random_uuid(),
  ride_id uuid not null,
  member_id uuid not null,
  kind ride_alert_kind not null,
  lat double precision,
  lng double precision,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  resolved_by uuid,
  constraint ride_alerts_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint ride_alerts_pkey PRIMARY KEY (id),
  constraint ride_alerts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint ride_alerts_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
);
CREATE INDEX ride_alerts_ride ON public.ride_alerts USING btree (ride_id);
CREATE UNIQUE INDEX ride_alerts_one_open ON public.ride_alerts USING btree (ride_id, member_id, kind) WHERE ((resolved_at IS NULL) AND (kind <> 'regroup'::ride_alert_kind));
CREATE INDEX ride_alerts_member_id_idx ON public.ride_alerts USING btree (member_id);
CREATE INDEX ride_alerts_resolved_by_idx ON public.ride_alerts USING btree (resolved_by);

-- public.ride_briefing_reads  [RLS ON]
create table public.ride_briefing_reads (
  ride_id uuid not null,
  member_id uuid not null,
  read_at timestamp with time zone not null default now(),
  constraint ride_briefing_reads_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint ride_briefing_reads_pkey PRIMARY KEY (ride_id, member_id),
  constraint ride_briefing_reads_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
);
CREATE INDEX ride_briefing_reads_member ON public.ride_briefing_reads USING btree (member_id);

-- public.ride_briefings  [RLS ON]
create table public.ride_briefings (
  ride_id uuid not null,
  hazards text[] not null default '{}'::text[],
  changes text,
  notes text,
  updated_by uuid,
  updated_at timestamp with time zone not null default now(),
  constraint ride_briefings_changes_check CHECK ((char_length(changes) <= 2000)),
  constraint ride_briefings_hazards_check CHECK (((cardinality(hazards) <= 12) AND private.hazards_ok(hazards))),
  constraint ride_briefings_notes_check CHECK ((char_length(notes) <= 2000)),
  constraint ride_briefings_pkey PRIMARY KEY (ride_id),
  constraint ride_briefings_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
  constraint ride_briefings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX ride_briefings_updated_by_idx ON public.ride_briefings USING btree (updated_by);

-- public.ride_calls  [RLS ON]
create table public.ride_calls (
  ride_id uuid not null,
  state ride_call_state not null,
  reason text,
  new_day date,
  called_by uuid,
  called_at timestamp with time zone not null default now(),
  constraint ride_calls_called_by_fkey FOREIGN KEY (called_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint ride_calls_check CHECK (((new_day IS NULL) OR (state = 'postponed'::ride_call_state))),
  constraint ride_calls_pkey PRIMARY KEY (ride_id),
  constraint ride_calls_reason_check CHECK ((char_length(reason) <= 200)),
  constraint ride_calls_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
);
CREATE INDEX ride_calls_called_by_idx ON public.ride_calls USING btree (called_by);

-- public.ride_crew  [RLS ON]
create table public.ride_crew (
  ride_id uuid not null,
  member_id uuid not null,
  role crew_role not null,
  assigned_by uuid,
  assigned_at timestamp with time zone not null default now(),
  constraint ride_crew_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint ride_crew_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint ride_crew_pkey PRIMARY KEY (ride_id, member_id),
  constraint ride_crew_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX ride_crew_one_per_spot ON public.ride_crew USING btree (ride_id, role) WHERE (role <> 'officer'::crew_role);
CREATE INDEX ride_crew_member ON public.ride_crew USING btree (member_id);
CREATE INDEX ride_crew_assigned_by_idx ON public.ride_crew USING btree (assigned_by);

-- public.ride_hubs  [RLS ON]
create table public.ride_hubs (
  ride_id uuid not null,
  members_only boolean not null default true,
  closes_on date,
  beds integer,
  accommodation text,
  notes text,
  updated_by uuid,
  updated_at timestamp with time zone not null default now(),
  constraint ride_hubs_accommodation_check CHECK ((char_length(accommodation) <= 1000)),
  constraint ride_hubs_beds_check CHECK (((beds >= 1) AND (beds <= 500))),
  constraint ride_hubs_notes_check CHECK ((char_length(notes) <= 1000)),
  constraint ride_hubs_pkey PRIMARY KEY (ride_id),
  constraint ride_hubs_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
  constraint ride_hubs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX ride_hubs_updated_by_idx ON public.ride_hubs USING btree (updated_by);

-- public.ride_plans  [RLS ON]
create table public.ride_plans (
  ride_id uuid not null,
  stops jsonb not null default '[]'::jsonb,
  updated_by uuid,
  updated_at timestamp with time zone not null default now(),
  constraint ride_plans_pkey PRIMARY KEY (ride_id),
  constraint ride_plans_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
  constraint ride_plans_stops_check CHECK (((jsonb_typeof(stops) = 'array'::text) AND (jsonb_array_length(stops) <= 15))),
  constraint ride_plans_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX ride_plans_updated_by_idx ON public.ride_plans USING btree (updated_by);

-- public.ride_routes  [RLS ON]
create table public.ride_routes (
  ride_id uuid not null,
  route_id uuid,
  set_by uuid,
  set_at timestamp with time zone not null default now(),
  constraint ride_routes_pkey PRIMARY KEY (ride_id),
  constraint ride_routes_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE,
  constraint ride_routes_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes(id),
  constraint ride_routes_set_by_fkey FOREIGN KEY (set_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX ride_routes_route ON public.ride_routes USING btree (route_id);
CREATE INDEX ride_routes_set_by_idx ON public.ride_routes USING btree (set_by);

-- public.rides  [RLS ON]
create table public.rides (
  id uuid not null default gen_random_uuid(),
  source text not null default 'feed'::text,
  feed_id uuid,
  external_uid text,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone,
  all_day boolean not null default false,
  title text not null,
  location text,
  notes text,
  category ride_category not null,
  cancelled_at timestamp with time zone,
  synced_at timestamp with time zone not null default now(),
  website boolean not null default true,
  created_by uuid,
  updated_by uuid,
  updated_at timestamp with time zone,
  constraint rides_created_by_fkey FOREIGN KEY (created_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint rides_feed_id_external_uid_starts_at_key UNIQUE (feed_id, external_uid, starts_at),
  constraint rides_feed_id_fkey FOREIGN KEY (feed_id) REFERENCES private.ride_feeds(id) ON DELETE SET NULL,
  constraint rides_pkey PRIMARY KEY (id),
  constraint rides_source_check CHECK ((source = ANY (ARRAY['feed'::text, 'app'::text]))),
  constraint rides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX rides_feed_id_external_uid_starts_at_key ON public.rides USING btree (feed_id, external_uid, starts_at);
CREATE INDEX rides_starts_at ON public.rides USING btree (starts_at);
CREATE INDEX rides_created_by ON public.rides USING btree (created_by);
CREATE INDEX rides_updated_by ON public.rides USING btree (updated_by);

-- public.road_rules_signoffs  [RLS ON]
create table public.road_rules_signoffs (
  member_id uuid not null,
  version integer not null,
  signed_at timestamp with time zone not null,
  constraint road_rules_signoffs_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint road_rules_signoffs_pkey PRIMARY KEY (member_id),
  constraint road_rules_signoffs_version_fkey FOREIGN KEY (version) REFERENCES road_rules_versions(number)
);
CREATE INDEX road_rules_signoffs_version ON public.road_rules_signoffs USING btree (version);

-- public.road_rules_versions  [RLS ON]
create table public.road_rules_versions (
  number integer not null,
  body text not null,
  changes text,
  fresh boolean not null,
  published_by uuid,
  published_at timestamp with time zone not null default now(),
  constraint road_rules_versions_body_check CHECK (((char_length(body) <= 20000) AND (private.trim_like_app(body) <> ''::text))),
  constraint road_rules_versions_changes_check CHECK ((char_length(changes) <= 500)),
  constraint road_rules_versions_check CHECK (((number <> 1) OR fresh)),
  constraint road_rules_versions_number_check CHECK ((number >= 1)),
  constraint road_rules_versions_pkey PRIMARY KEY (number),
  constraint road_rules_versions_published_by_fkey FOREIGN KEY (published_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX road_rules_versions_published_by_idx ON public.road_rules_versions USING btree (published_by);

-- public.route_ratings  [RLS ON]
create table public.route_ratings (
  route_id uuid not null,
  member_id uuid not null,
  stars integer not null,
  comment text,
  rated_at timestamp with time zone not null default now(),
  constraint route_ratings_comment_check CHECK ((char_length(comment) <= 280)),
  constraint route_ratings_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint route_ratings_pkey PRIMARY KEY (route_id, member_id),
  constraint route_ratings_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
  constraint route_ratings_stars_check CHECK (((stars >= 1) AND (stars <= 5)))
);
CREATE INDEX route_ratings_member_id_idx ON public.route_ratings USING btree (member_id);

-- public.routes  [RLS ON]
create table public.routes (
  id uuid not null default gen_random_uuid(),
  name text not null,
  chapter_id uuid,
  notes text,
  gpx text not null,
  distance_m integer not null default 0,
  climb_m integer,
  line jsonb not null default '[]'::jsonb,
  stops jsonb not null default '[]'::jsonb,
  bounds jsonb,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_by uuid,
  updated_at timestamp with time zone not null default now(),
  archived_at timestamp with time zone,
  constraint routes_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint routes_created_by_fkey FOREIGN KEY (created_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint routes_gpx_check CHECK ((octet_length(gpx) <= 5242880)),
  constraint routes_line_check CHECK ((jsonb_typeof(line) = 'array'::text)),
  constraint routes_name_check CHECK (((char_length(private.trim_like_app(name)) >= 1) AND (char_length(private.trim_like_app(name)) <= 80))),
  constraint routes_pkey PRIMARY KEY (id),
  constraint routes_stops_check CHECK ((jsonb_typeof(stops) = 'array'::text)),
  constraint routes_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX routes_chapter_id_idx ON public.routes USING btree (chapter_id);
CREATE INDEX routes_created_by_idx ON public.routes USING btree (created_by);
CREATE INDEX routes_updated_by_idx ON public.routes USING btree (updated_by);

-- public.rsvps  [RLS ON]
create table public.rsvps (
  ride_id uuid not null,
  member_id uuid not null,
  answer rsvp_answer not null,
  updated_at timestamp with time zone not null default now(),
  constraint rsvps_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint rsvps_pkey PRIMARY KEY (ride_id, member_id),
  constraint rsvps_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
);
CREATE INDEX rsvps_member_id_idx ON public.rsvps USING btree (member_id);

-- public.shop_designs  [RLS ON]
create table public.shop_designs (
  id uuid not null default gen_random_uuid(),
  name text not null,
  eligibility text not null,
  blurb text,
  sort integer not null default 0,
  on_sale boolean not null default true,
  updated_by uuid,
  updated_at timestamp with time zone not null default now(),
  constraint shop_designs_blurb_check CHECK ((char_length(blurb) <= 300)),
  constraint shop_designs_eligibility_check CHECK ((eligibility = ANY (ARRAY['any'::text, 'patched'::text, 'family'::text]))),
  constraint shop_designs_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60))),
  constraint shop_designs_pkey PRIMARY KEY (id),
  constraint shop_designs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX shop_designs_updated_by ON public.shop_designs USING btree (updated_by);

-- public.shop_garments  [RLS ON]
create table public.shop_garments (
  id uuid not null default gen_random_uuid(),
  design_id uuid not null,
  name text not null,
  price_cents integer not null,
  sizes text[] not null default '{}'::text[],
  colours text[] not null default '{}'::text[],
  sort integer not null default 0,
  on_sale boolean not null default true,
  constraint shop_garments_design_id_fkey FOREIGN KEY (design_id) REFERENCES shop_designs(id) ON DELETE CASCADE,
  constraint shop_garments_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60))),
  constraint shop_garments_pkey PRIMARY KEY (id),
  constraint shop_garments_price_cents_check CHECK (((price_cents >= 1) AND (price_cents <= 100000)))
);
CREATE INDEX shop_garments_design ON public.shop_garments USING btree (design_id);

-- public.shop_order_lines  [RLS ON]
create table public.shop_order_lines (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  garment_id uuid,
  design_name text not null,
  garment_name text not null,
  size text,
  colour text,
  qty integer not null,
  unit_cents integer not null,
  constraint shop_order_lines_garment_id_fkey FOREIGN KEY (garment_id) REFERENCES shop_garments(id) ON DELETE SET NULL,
  constraint shop_order_lines_order_id_fkey FOREIGN KEY (order_id) REFERENCES shop_orders(id) ON DELETE CASCADE,
  constraint shop_order_lines_pkey PRIMARY KEY (id),
  constraint shop_order_lines_qty_check CHECK (((qty >= 1) AND (qty <= 10))),
  constraint shop_order_lines_unit_cents_check CHECK ((unit_cents > 0))
);
CREATE INDEX shop_order_lines_order ON public.shop_order_lines USING btree (order_id);
CREATE INDEX shop_order_lines_garment ON public.shop_order_lines USING btree (garment_id);

-- public.shop_orders  [RLS ON]
create table public.shop_orders (
  id uuid not null default gen_random_uuid(),
  member_id uuid not null,
  client_ref uuid not null,
  buyer_name text not null,
  road_name text,
  email text not null,
  phone text,
  delivery text not null,
  street text,
  suburb text,
  state text,
  postcode text,
  shipping_method text,
  subtotal_cents integer not null,
  shipping_cents integer not null default 0,
  status text not null default 'held'::text,
  make_sent_at timestamp with time zone,
  make_error text,
  paid_on date,
  paid_cents integer,
  ledger_entry_id uuid,
  handed_over_on date,
  cancelled_at timestamp with time zone,
  cancelled_by uuid,
  ordered_at timestamp with time zone not null default now(),
  constraint shop_orders_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint shop_orders_check CHECK (((delivery = 'collect'::text) OR (shipping_method IS NOT NULL))),
  constraint shop_orders_delivery_check CHECK ((delivery = ANY (ARRAY['ship'::text, 'collect'::text]))),
  constraint shop_orders_email_check CHECK ((char_length(email) <= 200)),
  constraint shop_orders_ledger_entry_id_fkey FOREIGN KEY (ledger_entry_id) REFERENCES ledger_entries(id),
  constraint shop_orders_member_id_client_ref_key UNIQUE (member_id, client_ref),
  constraint shop_orders_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
  constraint shop_orders_paid_cents_check CHECK (((paid_cents >= 1) AND (paid_cents <= 1000000))),
  constraint shop_orders_phone_check CHECK ((char_length(phone) <= 30)),
  constraint shop_orders_pkey PRIMARY KEY (id),
  constraint shop_orders_shipping_cents_check CHECK ((shipping_cents >= 0)),
  constraint shop_orders_shipping_method_check CHECK ((shipping_method = ANY (ARRAY['standard'::text, 'express'::text]))),
  constraint shop_orders_status_check CHECK ((status = ANY (ARRAY['held'::text, 'sent'::text, 'paid'::text, 'posted'::text, 'collected'::text, 'cancelled'::text]))),
  constraint shop_orders_street_check CHECK ((char_length(street) <= 120)),
  constraint shop_orders_subtotal_cents_check CHECK ((subtotal_cents > 0)),
  constraint shop_orders_suburb_check CHECK ((char_length(suburb) <= 60))
);
CREATE UNIQUE INDEX shop_orders_member_id_client_ref_key ON public.shop_orders USING btree (member_id, client_ref);
CREATE INDEX shop_orders_member_ordered ON public.shop_orders USING btree (member_id, ordered_at);
CREATE INDEX shop_orders_status ON public.shop_orders USING btree (status);
CREATE INDEX shop_orders_ledger_entry ON public.shop_orders USING btree (ledger_entry_id);
CREATE INDEX shop_orders_cancelled_by ON public.shop_orders USING btree (cancelled_by);

-- public.shop_pictures  [RLS ON]
create table public.shop_pictures (
  id uuid not null default gen_random_uuid(),
  design_id uuid not null,
  garment_id uuid,
  colour text,
  side text not null,
  path text not null,
  sort integer not null default 0,
  added_by uuid,
  added_at timestamp with time zone not null default now(),
  constraint shop_pictures_added_by_fkey FOREIGN KEY (added_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint shop_pictures_colour_check CHECK (((char_length(colour) >= 1) AND (char_length(colour) <= 20))),
  constraint shop_pictures_design_id_fkey FOREIGN KEY (design_id) REFERENCES shop_designs(id) ON DELETE CASCADE,
  constraint shop_pictures_garment_id_fkey FOREIGN KEY (garment_id) REFERENCES shop_garments(id) ON DELETE CASCADE,
  constraint shop_pictures_path_check CHECK (((char_length(path) >= 3) AND (char_length(path) <= 200))),
  constraint shop_pictures_path_key UNIQUE (path),
  constraint shop_pictures_pkey PRIMARY KEY (id),
  constraint shop_pictures_side_check CHECK ((side = ANY (ARRAY['front'::text, 'back'::text])))
);
CREATE UNIQUE INDEX shop_pictures_path_key ON public.shop_pictures USING btree (path);
CREATE INDEX shop_pictures_design ON public.shop_pictures USING btree (design_id);
CREATE INDEX shop_pictures_garment ON public.shop_pictures USING btree (garment_id);
CREATE INDEX shop_pictures_added_by ON public.shop_pictures USING btree (added_by);

-- public.shop_runners  [RLS ON]
create table public.shop_runners (
  member_id uuid not null,
  named_by uuid,
  named_on date not null default ((now() AT TIME ZONE 'Australia/Melbourne'::text))::date,
  constraint shop_runners_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint shop_runners_named_by_fkey FOREIGN KEY (named_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint shop_runners_pkey PRIMARY KEY (member_id)
);
CREATE INDEX shop_runners_named_by ON public.shop_runners USING btree (named_by);

-- public.shop_shipping  [RLS ON]
create table public.shop_shipping (
  state text not null,
  method text not null,
  cents integer not null,
  constraint shop_shipping_cents_check CHECK (((cents >= 0) AND (cents <= 100000))),
  constraint shop_shipping_method_check CHECK ((method = ANY (ARRAY['standard'::text, 'express'::text]))),
  constraint shop_shipping_pkey PRIMARY KEY (state, method),
  constraint shop_shipping_state_check CHECK ((state = ANY (ARRAY['ACT'::text, 'NSW'::text, 'NT'::text, 'QLD'::text, 'SA'::text, 'TAS'::text, 'VIC'::text, 'WA'::text])))
);

-- public.site_enquiries  [RLS ON]
create table public.site_enquiries (
  id uuid not null default gen_random_uuid(),
  name text not null,
  email text not null,
  chapter_slug text not null,
  about text,
  created_at timestamp with time zone not null default now(),
  handled_at timestamp with time zone,
  handled_by uuid,
  note text,
  constraint site_enquiries_about_check CHECK ((length(about) <= 600)),
  constraint site_enquiries_chapter_slug_check CHECK ((chapter_slug = ANY (ARRAY['west'::text, 'north'::text, 'either'::text]))),
  constraint site_enquiries_check CHECK (((handled_at IS NULL) = (handled_by IS NULL))),
  constraint site_enquiries_email_check CHECK ((length(email) <= 200)),
  constraint site_enquiries_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint site_enquiries_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80))),
  constraint site_enquiries_note_check CHECK ((length(note) <= 300)),
  constraint site_enquiries_pkey PRIMARY KEY (id)
);
CREATE INDEX site_enquiries_handled_by_idx ON public.site_enquiries USING btree (handled_by);
CREATE INDEX site_enquiries_email_created_idx ON public.site_enquiries USING btree (email, created_at);
CREATE INDEX site_enquiries_created_idx ON public.site_enquiries USING btree (created_at);

-- public.site_news  [RLS ON]
create table public.site_news (
  id uuid not null default gen_random_uuid(),
  title text not null,
  body text not null,
  link text,
  posted_by uuid,
  created_at timestamp with time zone not null default now(),
  removed_at timestamp with time zone,
  removed_by uuid,
  constraint site_news_body_check CHECK (((length(body) >= 1) AND (length(body) <= 400))),
  constraint site_news_check CHECK (((removed_at IS NULL) = (removed_by IS NULL))),
  constraint site_news_link_check CHECK (((link ~ '^https://\S+$'::text) AND (length(link) <= 300))),
  constraint site_news_pkey PRIMARY KEY (id),
  constraint site_news_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint site_news_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint site_news_title_check CHECK (((length(title) >= 1) AND (length(title) <= 80)))
);
CREATE INDEX site_news_created_idx ON public.site_news USING btree (created_at DESC);
CREATE INDEX site_news_posted_by_idx ON public.site_news USING btree (posted_by);
CREATE INDEX site_news_removed_by_idx ON public.site_news USING btree (removed_by);

-- public.site_photo_crew  [RLS ON]
create table public.site_photo_crew (
  member_id uuid not null,
  added_by uuid,
  added_at timestamp with time zone not null default now(),
  constraint site_photo_crew_added_by_fkey FOREIGN KEY (added_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint site_photo_crew_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint site_photo_crew_pkey PRIMARY KEY (member_id)
);
CREATE INDEX site_photo_crew_added_by_idx ON public.site_photo_crew USING btree (added_by);

-- public.site_photos  [RLS ON]
create table public.site_photos (
  id uuid not null default gen_random_uuid(),
  source site_photo_source not null,
  media_id uuid,
  bucket text not null,
  path text not null,
  width integer not null default 0,
  height integer not null default 0,
  caption text,
  posted_by uuid,
  picked_by uuid,
  picked_at timestamp with time zone not null default now(),
  status site_photo_status not null,
  decided_at timestamp with time zone,
  removed_at timestamp with time zone,
  removed_by uuid,
  constraint site_photos_bucket_check CHECK ((bucket = ANY (ARRAY['chat-media'::text, 'site-media'::text]))),
  constraint site_photos_caption_check CHECK (((caption IS NULL) OR ((length(caption) >= 1) AND (length(caption) <= 120)))),
  constraint site_photos_check CHECK (((source = 'chat'::site_photo_source) = (media_id IS NOT NULL))),
  constraint site_photos_check1 CHECK (((source = 'chat'::site_photo_source) = (bucket = 'chat-media'::text))),
  constraint site_photos_check2 CHECK (((removed_at IS NULL) = (status <> 'removed'::site_photo_status))),
  constraint site_photos_media_id_fkey FOREIGN KEY (media_id) REFERENCES message_media(id) ON DELETE CASCADE,
  constraint site_photos_picked_by_fkey FOREIGN KEY (picked_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint site_photos_pkey PRIMARY KEY (id),
  constraint site_photos_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint site_photos_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX site_photos_media_once ON public.site_photos USING btree (media_id) WHERE ((media_id IS NOT NULL) AND (status <> 'removed'::site_photo_status));
CREATE INDEX site_photos_posted_by_idx ON public.site_photos USING btree (posted_by, status);
CREATE INDEX site_photos_picked_by_idx ON public.site_photos USING btree (picked_by);
CREATE INDEX site_photos_removed_by_idx ON public.site_photos USING btree (removed_by);
CREATE INDEX site_photos_live_idx ON public.site_photos USING btree (picked_at DESC) WHERE (status = 'live'::site_photo_status);

-- public.site_visits  [RLS ON]
create table public.site_visits (
  day date not null,
  page text not null,
  hits integer not null default 0,
  constraint site_visits_hits_check CHECK ((hits >= 0)),
  constraint site_visits_page_check CHECK (((page ~ '^/[a-z0-9/._-]*$'::text) AND (length(page) <= 80))),
  constraint site_visits_pkey PRIMARY KEY (day, page)
);

-- public.sponsors  [RLS ON]
create table public.sponsors (
  id uuid not null default gen_random_uuid(),
  name text not null,
  blurb text,
  url text,
  deal text,
  logo_path text,
  chapter_id uuid,
  added_by uuid,
  added_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  archived_at timestamp with time zone,
  archived_by uuid,
  constraint sponsors_added_by_fkey FOREIGN KEY (added_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint sponsors_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint sponsors_blurb_check CHECK (((char_length(blurb) >= 1) AND (char_length(blurb) <= 300))),
  constraint sponsors_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint sponsors_deal_check CHECK (((char_length(deal) >= 1) AND (char_length(deal) <= 200))),
  constraint sponsors_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60))),
  constraint sponsors_pkey PRIMARY KEY (id),
  constraint sponsors_url_check CHECK (((char_length(url) <= 300) AND (url ~* '^https?://'::text)))
);
CREATE INDEX sponsors_added_by_idx ON public.sponsors USING btree (added_by);
CREATE INDEX sponsors_archived_by_idx ON public.sponsors USING btree (archived_by);
CREATE INDEX sponsors_chapter_id_idx ON public.sponsors USING btree (chapter_id);

-- public.status_changes  [RLS ON]
create table public.status_changes (
  id uuid not null default gen_random_uuid(),
  member_id uuid not null,
  chapter_id uuid not null,
  from_status member_status not null,
  to_status member_status not null,
  by_request boolean not null default false,
  notice_id uuid,
  changed_by uuid,
  changed_on date not null default private.club_date(),
  changed_at timestamp with time zone not null default now(),
  constraint status_changes_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint status_changes_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  constraint status_changes_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint status_changes_notice_id_fkey FOREIGN KEY (notice_id) REFERENCES status_notices(id) ON DELETE SET NULL,
  constraint status_changes_pkey PRIMARY KEY (id)
);
CREATE INDEX status_changes_member ON public.status_changes USING btree (member_id, changed_at DESC);
CREATE INDEX status_changes_chapter ON public.status_changes USING btree (chapter_id);
CREATE INDEX status_changes_changed_by_idx ON public.status_changes USING btree (changed_by);
CREATE INDEX status_changes_notice_id_idx ON public.status_changes USING btree (notice_id);

-- public.status_notices  [RLS ON]
create table public.status_notices (
  id uuid not null default gen_random_uuid(),
  member_id uuid not null,
  chapter_id uuid not null,
  about text not null,
  record text not null,
  proposal text not null,
  given_on date not null default private.club_date(),
  respond_by date not null,
  given_by uuid,
  response text,
  responded_at timestamp with time zone,
  outcome text,
  outcome_note text,
  closed_on date,
  closed_by uuid,
  constraint status_notices_about_check CHECK ((about = ANY (ARRAY['attendance'::text, 'dues'::text]))),
  constraint status_notices_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  constraint status_notices_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint status_notices_given_by_fkey FOREIGN KEY (given_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint status_notices_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  constraint status_notices_outcome_check CHECK ((outcome = ANY (ARRAY['withdrawn'::text, 'decided'::text]))),
  constraint status_notices_outcome_note_check CHECK ((char_length(outcome_note) <= 500)),
  constraint status_notices_pkey PRIMARY KEY (id),
  constraint status_notices_proposal_check CHECK (((char_length(proposal) >= 1) AND (char_length(proposal) <= 500))),
  constraint status_notices_record_check CHECK (((char_length(record) >= 1) AND (char_length(record) <= 2000))),
  constraint status_notices_response_check CHECK ((char_length(response) <= 2000))
);
CREATE INDEX status_notices_member ON public.status_notices USING btree (member_id);
CREATE UNIQUE INDEX status_notices_one_open ON public.status_notices USING btree (member_id, about) WHERE (outcome IS NULL);
CREATE INDEX status_notices_chapter ON public.status_notices USING btree (chapter_id);
CREATE INDEX status_notices_closed_by_idx ON public.status_notices USING btree (closed_by);
CREATE INDEX status_notices_given_by_idx ON public.status_notices USING btree (given_by);

-- public.treasurer_meeting_reports  [RLS ON]
create table public.treasurer_meeting_reports (
  id uuid not null default gen_random_uuid(),
  from_on date not null,
  to_on date not null,
  notes text not null default ''::text,
  saved_by uuid,
  saved_at timestamp with time zone not null default now(),
  presented_by uuid,
  presented_at timestamp with time zone,
  constraint treasurer_meeting_reports_check CHECK ((from_on <= to_on)),
  constraint treasurer_meeting_reports_notes_check CHECK ((char_length(notes) <= 4000)),
  constraint treasurer_meeting_reports_pkey PRIMARY KEY (id),
  constraint treasurer_meeting_reports_presented_by_fkey FOREIGN KEY (presented_by) REFERENCES members(id) ON DELETE SET NULL,
  constraint treasurer_meeting_reports_saved_by_fkey FOREIGN KEY (saved_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX treasurer_meeting_reports_presented_by_idx ON public.treasurer_meeting_reports USING btree (presented_by);
CREATE INDEX treasurer_meeting_reports_saved_by_idx ON public.treasurer_meeting_reports USING btree (saved_by);

-- public.treasurer_reports  [RLS ON]
create table public.treasurer_reports (
  month date not null,
  presented_at timestamp with time zone not null default now(),
  presented_by uuid,
  constraint treasurer_reports_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric)),
  constraint treasurer_reports_pkey PRIMARY KEY (month),
  constraint treasurer_reports_presented_by_fkey FOREIGN KEY (presented_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX treasurer_reports_presented_by_idx ON public.treasurer_reports USING btree (presented_by);

-- public.vote_ballots  [RLS ON]
create table public.vote_ballots (
  id uuid not null default gen_random_uuid(),
  vote_id uuid not null,
  member_id uuid,
  choice ballot_choice,
  constraint vote_ballots_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id),
  constraint vote_ballots_pkey PRIMARY KEY (id),
  constraint vote_ballots_vote_id_fkey FOREIGN KEY (vote_id) REFERENCES votes(id)
);
CREATE INDEX vote_ballots_member_id_idx ON public.vote_ballots USING btree (member_id);
CREATE INDEX vote_ballots_vote_id_idx ON public.vote_ballots USING btree (vote_id);

-- public.vote_electors  [RLS ON]
create table public.vote_electors (
  vote_id uuid not null,
  member_id uuid not null,
  voted_at timestamp with time zone,
  constraint vote_electors_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id),
  constraint vote_electors_pkey PRIMARY KEY (vote_id, member_id),
  constraint vote_electors_vote_id_fkey FOREIGN KEY (vote_id) REFERENCES votes(id)
);
CREATE INDEX vote_electors_member_id_idx ON public.vote_electors USING btree (member_id);

-- public.votes  [RLS ON]
create table public.votes (
  id uuid not null default gen_random_uuid(),
  chapter_id uuid,
  meeting_id uuid,
  subject_member_id uuid,
  question text not null,
  details text,
  electorate electorate not null,
  threshold vote_threshold not null,
  secret boolean not null default false,
  quorum integer not null,
  opened_at timestamp with time zone not null default now(),
  closes_at timestamp with time zone not null,
  closed_at timestamp with time zone,
  result vote_result,
  casting_vote text,
  yes_count integer,
  no_count integer,
  abstain_count integer,
  created_by uuid,
  subject_role position_role,
  constraint votes_casting_vote_check CHECK ((casting_vote = ANY (ARRAY['yes'::text, 'no'::text]))),
  constraint votes_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  constraint votes_created_by_fkey FOREIGN KEY (created_by) REFERENCES members(id),
  constraint votes_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES meetings(id),
  constraint votes_pkey PRIMARY KEY (id),
  constraint votes_quorum_check CHECK ((quorum >= 1)),
  constraint votes_subject_member_id_fkey FOREIGN KEY (subject_member_id) REFERENCES members(id),
  constraint votes_subject_role_check CHECK (((subject_role IS NULL) OR (subject_role <> ALL (ARRAY['founder'::position_role, 'nec_chair'::position_role]))))
);
CREATE INDEX votes_chapter_id_idx ON public.votes USING btree (chapter_id);
CREATE INDEX votes_created_by_idx ON public.votes USING btree (created_by);
CREATE INDEX votes_meeting_id_idx ON public.votes USING btree (meeting_id);
CREATE INDEX votes_subject_member_id_idx ON public.votes USING btree (subject_member_id);

-- public.website_signups  [RLS ON]
create table public.website_signups (
  id uuid not null default gen_random_uuid(),
  ride_id uuid not null,
  name text not null,
  email text not null,
  phone text,
  riding boolean not null default true,
  pillion boolean not null default false,
  guests integer not null default 0,
  guest_names text,
  job text,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint website_signups_check CHECK ((riding OR (job IS NOT NULL))),
  constraint website_signups_check1 CHECK ((riding OR (NOT pillion))),
  constraint website_signups_email_check CHECK ((char_length(email) <= 200)),
  constraint website_signups_guest_names_check CHECK ((char_length(guest_names) <= 200)),
  constraint website_signups_guests_check CHECK (((guests >= 0) AND (guests <= 10))),
  constraint website_signups_job_check CHECK ((char_length(job) <= 40)),
  constraint website_signups_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80))),
  constraint website_signups_notes_check CHECK ((char_length(notes) <= 200)),
  constraint website_signups_phone_check CHECK ((char_length(phone) <= 30)),
  constraint website_signups_pkey PRIMARY KEY (id),
  constraint website_signups_ride_id_email_key UNIQUE (ride_id, email),
  constraint website_signups_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES charity_rides(ride_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX website_signups_ride_id_email_key ON public.website_signups USING btree (ride_id, email);
CREATE INDEX website_signups_email_created_idx ON public.website_signups USING btree (email, created_at);
CREATE INDEX website_signups_created_idx ON public.website_signups USING btree (created_at);
