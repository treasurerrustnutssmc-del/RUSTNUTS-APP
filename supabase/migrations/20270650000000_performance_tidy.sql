-- Deep audit repair F4 (31 Oct 2026): the Supabase performance advisor listed 204 items on the live
-- database. This file clears the four kinds that are real and leaves one alone on purpose:
--
-- 1. 154 foreign keys had no covering index. Each gets a plain index on its columns, named
--    <table>_<columns>_idx, so joins on them and the row clean-ups behind "Delete my account" go through
--    an index instead of a table scan. Tables are small today; the indexes cost almost nothing to keep.
-- 2. 12 read policies called auth.uid() once per row. They now call (select auth.uid()), which Postgres
--    evaluates once per query. The rule in each policy is unchanged.
-- 3. 9 tables had two permissive policies for the same role and action, which Postgres has to evaluate
--    both of for every row. The National Auditor's extra read policies are folded into the main read
--    policy; the "for all" write policies on bikes, bike_registrations and emergency_contacts become
--    insert, update and delete policies (reading was already covered by the read policy); the two
--    sponsor read policies become one; chapters_manage, which allowed nothing (using false), goes.
--    Who can see and change what is exactly as before: the access tests and the parity cases prove it.
-- 4. budgets and fund_openings had no primary key (their natural key allows null chapter_id). Each gets
--    an id column; every insert names its columns, so nothing changes for the functions that use them.
--
-- Left alone: the "unused index" notes. The app has no traffic yet, so every index reads as unused, and
-- the new ones will too until launch. Several of those indexes enforce rules (bus_bookings_no_double_booking).
-- Revisit after a month of real use, dropping only what the statistics then show nobody needs.
--
-- Safe to run twice. Live: paste item from build/paste-queue.md, Jeff's Run.

-- 1. Covering indexes for every foreign key -------------------------------------------------------------
create index if not exists roster_chapter_id_idx on private.roster (chapter_id);
create index if not exists roster_claimed_by_idx on private.roster (claimed_by);
create index if not exists action_items_chapter_id_idx on public.action_items (chapter_id);
create index if not exists action_items_created_by_idx on public.action_items (created_by);
create index if not exists action_items_meeting_id_idx on public.action_items (meeting_id);
create index if not exists action_items_owner_id_idx on public.action_items (owner_id);
create index if not exists agms_recorded_by_idx on public.agms (recorded_by);
create index if not exists attendance_marked_by_idx on public.attendance (marked_by);
create index if not exists attendance_exemptions_granted_by_idx on public.attendance_exemptions (granted_by);
create index if not exists audit_reports_written_by_idx on public.audit_reports (written_by);
create index if not exists audit_requests_answered_by_idx on public.audit_requests (answered_by);
create index if not exists audit_requests_chapter_id_idx on public.audit_requests (chapter_id);
create index if not exists audit_requests_closed_by_idx on public.audit_requests (closed_by);
create index if not exists audit_requests_ledger_entry_id_idx on public.audit_requests (ledger_entry_id);
create index if not exists audit_requests_raised_by_idx on public.audit_requests (raised_by);
create index if not exists big4_rides_chapter_id_idx on public.big4_rides (chapter_id);
create index if not exists big4_rides_designated_by_idx on public.big4_rides (designated_by);
create index if not exists big4_waivers_granted_by_idx on public.big4_waivers (granted_by);
create index if not exists brag_awards_archived_by_idx on public.brag_awards (archived_by);
create index if not exists brag_awards_opened_by_idx on public.brag_awards (opened_by);
create index if not exists brag_nominations_nominated_by_idx on public.brag_nominations (nominated_by);
create index if not exists brag_nominations_ride_id_idx on public.brag_nominations (ride_id);
create index if not exists brag_nominations_withdrawn_by_idx on public.brag_nominations (withdrawn_by);
create index if not exists brag_votes_member_id_idx on public.brag_votes (member_id);
create index if not exists brag_votes_nomination_id_idx on public.brag_votes (nomination_id);
create index if not exists budgets_approved_by_idx on public.budgets (approved_by);
create index if not exists budgets_approved_vote_id_idx on public.budgets (approved_vote_id);
create index if not exists budgets_chapter_id_idx on public.budgets (chapter_id);
create index if not exists budgets_updated_by_idx on public.budgets (updated_by);
create index if not exists build_updates_author_id_idx on public.build_updates (author_id);
create index if not exists build_updates_taken_down_by_idx on public.build_updates (taken_down_by);
create index if not exists bus_bookings_booked_by_idx on public.bus_bookings (booked_by);
create index if not exists bus_bookings_cancelled_by_idx on public.bus_bookings (cancelled_by);
create index if not exists bus_bookings_changed_by_idx on public.bus_bookings (changed_by);
create index if not exists bus_bookings_decided_by_idx on public.bus_bookings (decided_by);
create index if not exists bus_bookings_driver_id_idx on public.bus_bookings (driver_id);
create index if not exists bus_costs_logged_by_idx on public.bus_costs (logged_by);
create index if not exists bus_costs_struck_by_idx on public.bus_costs (struck_by);
create index if not exists bus_key_handovers_logged_by_idx on public.bus_key_handovers (logged_by);
create index if not exists bus_key_handovers_to_id_idx on public.bus_key_handovers (to_id);
create index if not exists bus_km_logged_by_idx on public.bus_km (logged_by);
create index if not exists bus_km_struck_by_idx on public.bus_km (struck_by);
create index if not exists cash_floats_set_by_idx on public.cash_floats (set_by);
create index if not exists chapter_proposals_chapter_id_idx on public.chapter_proposals (chapter_id);
create index if not exists chapter_proposals_decided_by_idx on public.chapter_proposals (decided_by);
create index if not exists chapter_proposals_president_id_idx on public.chapter_proposals (president_id);
create index if not exists chapter_proposals_proposed_by_idx on public.chapter_proposals (proposed_by);
create index if not exists chapter_proposals_saa_id_idx on public.chapter_proposals (saa_id);
create index if not exists chapter_proposals_vote_id_idx on public.chapter_proposals (vote_id);
create index if not exists charges_raised_by_idx on public.charges (raised_by);
create index if not exists charges_waived_by_idx on public.charges (waived_by);
create index if not exists charity_rides_updated_by_idx on public.charity_rides (updated_by);
create index if not exists charity_signups_member_id_idx on public.charity_signups (member_id);
create index if not exists chat_reads_member_id_idx on public.chat_reads (member_id);
create index if not exists checkin_sessions_chapter_id_idx on public.checkin_sessions (chapter_id);
create index if not exists checkin_sessions_opened_by_idx on public.checkin_sessions (opened_by);
create index if not exists club_history_added_by_idx on public.club_history (added_by);
create index if not exists club_history_archived_by_idx on public.club_history (archived_by);
create index if not exists club_honours_added_by_idx on public.club_honours (added_by);
create index if not exists club_honours_archived_by_idx on public.club_honours (archived_by);
create index if not exists club_honours_member_id_idx on public.club_honours (member_id);
create index if not exists club_invites_added_by_idx on public.club_invites (added_by);
create index if not exists club_invites_answered_by_idx on public.club_invites (answered_by);
create index if not exists club_invites_archived_by_idx on public.club_invites (archived_by);
create index if not exists club_invites_chapter_id_idx on public.club_invites (chapter_id);
create index if not exists conduct_appeals_decided_by_idx on public.conduct_appeals (decided_by);
create index if not exists conduct_appeals_lodged_by_idx on public.conduct_appeals (lodged_by);
create index if not exists conduct_records_chapter_id_idx on public.conduct_records (chapter_id);
create index if not exists conduct_records_member_id_idx on public.conduct_records (member_id);
create index if not exists conduct_records_recorded_by_idx on public.conduct_records (recorded_by);
create index if not exists content_reports_author_id_idx on public.content_reports (author_id);
create index if not exists content_reports_reporter_id_idx on public.content_reports (reporter_id);
create index if not exists content_reports_resolved_by_idx on public.content_reports (resolved_by);
create index if not exists contribution_decisions_chapter_id_idx on public.contribution_decisions (chapter_id);
create index if not exists contribution_decisions_recorded_by_idx on public.contribution_decisions (recorded_by);
create index if not exists contribution_decisions_vote_id_idx on public.contribution_decisions (vote_id);
create index if not exists conversation_members_member_id_idx on public.conversation_members (member_id);
create index if not exists conversations_pinned_message_id_idx on public.conversations (pinned_message_id);
create index if not exists crew_swaps_asked_by_idx on public.crew_swaps (asked_by);
create index if not exists crew_swaps_asked_to_idx on public.crew_swaps (asked_to);
create index if not exists document_signoffs_member_id_idx on public.document_signoffs (member_id);
create index if not exists document_versions_published_by_idx on public.document_versions (published_by);
create index if not exists documents_chapter_id_idx on public.documents (chapter_id);
create index if not exists documents_created_by_idx on public.documents (created_by);
create index if not exists fund_openings_chapter_id_idx on public.fund_openings (chapter_id);
create index if not exists fund_openings_set_by_idx on public.fund_openings (set_by);
create index if not exists hub_registrations_member_id_idx on public.hub_registrations (member_id);
create index if not exists ledger_approvals_member_id_idx on public.ledger_approvals (member_id);
create index if not exists ledger_entries_code_idx on public.ledger_entries (code);
create index if not exists ledger_entries_payee_member_id_idx on public.ledger_entries (payee_member_id);
create index if not exists ledger_entries_recorded_by_idx on public.ledger_entries (recorded_by);
create index if not exists ledger_entries_voided_by_idx on public.ledger_entries (voided_by);
create index if not exists listings_taken_down_by_idx on public.listings (taken_down_by);
create index if not exists live_riders_member_id_idx on public.live_riders (member_id);
create index if not exists mechanic_vouches_member_id_idx on public.mechanic_vouches (member_id);
create index if not exists mechanics_added_by_idx on public.mechanics (added_by);
create index if not exists mechanics_archived_by_idx on public.mechanics (archived_by);
create index if not exists meetings_chapter_id_idx on public.meetings (chapter_id);
create index if not exists meetings_created_by_idx on public.meetings (created_by);
create index if not exists meetings_minutes_approved_by_idx on public.meetings (minutes_approved_by);
create index if not exists member_blocks_blocked_id_idx on public.member_blocks (blocked_id);
create index if not exists member_decisions_recorded_by_idx on public.member_decisions (recorded_by);
create index if not exists merch_items_chapter_id_idx on public.merch_items (chapter_id);
create index if not exists merch_items_decided_by_idx on public.merch_items (decided_by);
create index if not exists merch_items_proposed_by_idx on public.merch_items (proposed_by);
create index if not exists merch_orders_decided_by_idx on public.merch_orders (decided_by);
create index if not exists merch_orders_item_id_idx on public.merch_orders (item_id);
create index if not exists merch_orders_ledger_entry_id_idx on public.merch_orders (ledger_entry_id);
create index if not exists merch_orders_member_id_idx on public.merch_orders (member_id);
create index if not exists message_media_conversation_id_idx on public.message_media (conversation_id);
create index if not exists message_reactions_member_id_idx on public.message_reactions (member_id);
create index if not exists message_reports_reporter_id_idx on public.message_reports (reporter_id);
create index if not exists message_reports_resolved_by_idx on public.message_reports (resolved_by);
create index if not exists messages_author_id_idx on public.messages (author_id);
create index if not exists messages_removed_by_idx on public.messages (removed_by);
create index if not exists messages_reply_to_id_idx on public.messages (reply_to_id);
create index if not exists national_contributions_proposed_by_idx on public.national_contributions (proposed_by);
create index if not exists other_clubs_added_by_idx on public.other_clubs (added_by);
create index if not exists other_clubs_archived_by_idx on public.other_clubs (archived_by);
create index if not exists payments_claimed_by_idx on public.payments (claimed_by);
create index if not exists payments_decided_by_idx on public.payments (decided_by);
create index if not exists positions_appointed_by_idx on public.positions (appointed_by);
create index if not exists positions_ended_by_idx on public.positions (ended_by);
create index if not exists ride_alerts_member_id_idx on public.ride_alerts (member_id);
create index if not exists ride_alerts_resolved_by_idx on public.ride_alerts (resolved_by);
create index if not exists ride_briefings_updated_by_idx on public.ride_briefings (updated_by);
create index if not exists ride_calls_called_by_idx on public.ride_calls (called_by);
create index if not exists ride_crew_assigned_by_idx on public.ride_crew (assigned_by);
create index if not exists ride_hubs_updated_by_idx on public.ride_hubs (updated_by);
create index if not exists ride_plans_updated_by_idx on public.ride_plans (updated_by);
create index if not exists ride_routes_set_by_idx on public.ride_routes (set_by);
create index if not exists road_rules_versions_published_by_idx on public.road_rules_versions (published_by);
create index if not exists route_ratings_member_id_idx on public.route_ratings (member_id);
create index if not exists routes_chapter_id_idx on public.routes (chapter_id);
create index if not exists routes_created_by_idx on public.routes (created_by);
create index if not exists routes_updated_by_idx on public.routes (updated_by);
create index if not exists rsvps_member_id_idx on public.rsvps (member_id);
create index if not exists sponsors_added_by_idx on public.sponsors (added_by);
create index if not exists sponsors_archived_by_idx on public.sponsors (archived_by);
create index if not exists sponsors_chapter_id_idx on public.sponsors (chapter_id);
create index if not exists status_changes_changed_by_idx on public.status_changes (changed_by);
create index if not exists status_changes_notice_id_idx on public.status_changes (notice_id);
create index if not exists status_notices_closed_by_idx on public.status_notices (closed_by);
create index if not exists status_notices_given_by_idx on public.status_notices (given_by);
create index if not exists treasurer_meeting_reports_presented_by_idx on public.treasurer_meeting_reports (presented_by);
create index if not exists treasurer_meeting_reports_saved_by_idx on public.treasurer_meeting_reports (saved_by);
create index if not exists treasurer_reports_presented_by_idx on public.treasurer_reports (presented_by);
create index if not exists vote_ballots_member_id_idx on public.vote_ballots (member_id);
create index if not exists vote_ballots_vote_id_idx on public.vote_ballots (vote_id);
create index if not exists vote_electors_member_id_idx on public.vote_electors (member_id);
create index if not exists votes_chapter_id_idx on public.votes (chapter_id);
create index if not exists votes_created_by_idx on public.votes (created_by);
create index if not exists votes_meeting_id_idx on public.votes (meeting_id);
create index if not exists votes_subject_member_id_idx on public.votes (subject_member_id);

-- 2. auth.uid() once per query, not once per row ----------------------------------------------------------
alter policy chat_reads_own on public.chat_reads using (member_id = (select auth.uid()));
alter policy member_blocks_own on public.member_blocks using (blocker_id = (select auth.uid()));
alter policy charges_read on public.charges using (member_id = (select auth.uid()) or private.can_see_fees(chapter_id));
alter policy notification_prefs_own on public.notification_prefs using (member_id = (select auth.uid()));
alter policy brag_votes_own on public.brag_votes using (private.is_approved_member() and member_id = (select auth.uid()));
alter policy big4_waivers_read on public.big4_waivers using (
  member_id = (select auth.uid()) or private.sees_board_of(private.chapter_of(member_id))
);
alter policy status_notices_read on public.status_notices using (
  member_id = (select auth.uid()) or private.sees_board_of(chapter_id)
);
alter policy hub_registrations_for_members on public.hub_registrations using (
  private.is_approved_member() and (
    member_id = (select auth.uid()) or private.manages_ride(ride_id) or private.sees_board_of(private.chapter_of(member_id))
  )
);
alter policy charity_signups_for_members on public.charity_signups using (
  private.is_approved_member() and (
    member_id = (select auth.uid()) or private.runs_charity(ride_id) or private.sees_board_of(private.chapter_of(member_id))
  )
);
alter policy status_changes_read on public.status_changes using (
  member_id = (select auth.uid()) or private.sees_board_of(chapter_id) or private.is_auditor()
);

-- 3. One permissive policy per role and action --------------------------------------------------------------
-- The Auditor's reads join the main read policy (attendance_read and attendance_exemptions_read also get
-- the once-per-query auth.uid() from part 2).
alter policy attendance_read on public.attendance using (
  member_id = (select auth.uid())
  or private.sees_board_of(private.chapter_of(member_id))
  or private.is_auditor()
  or (
    private.is_approved_member() and private.is_approved(member_id)
    and exists (select 1 from public.checkin_sessions s where s.id = session_id and s.kind = 'ride')
  )
);
drop policy if exists attendance_auditor_read on public.attendance;

alter policy attendance_exemptions_read on public.attendance_exemptions using (
  member_id = (select auth.uid()) or private.sees_board_of(private.chapter_of(member_id)) or private.is_auditor()
);
drop policy if exists attendance_exemptions_auditor_read on public.attendance_exemptions;

alter policy member_decisions_read on public.member_decisions using (
  private.sees_board_of(private.chapter_of(member_id)) or private.is_auditor()
);
drop policy if exists member_decisions_auditor_read on public.member_decisions;

alter policy members_read on public.members using (
  id = (select auth.uid())
  or (approval = 'approved' and private.is_approved_member())
  or private.sees_board_of(chapter_id)
  or private.is_auditor()
);
drop policy if exists members_auditor_read on public.members;

-- Writing your own bikes, registrations and emergency contacts: the same rule, as insert, update and delete
-- policies. Reading them was already covered by bikes_read, regos_read and emergency_read.
drop policy if exists bikes_write_own on public.bikes;
drop policy if exists bikes_insert_own on public.bikes;
drop policy if exists bikes_update_own on public.bikes;
drop policy if exists bikes_delete_own on public.bikes;
create policy bikes_insert_own on public.bikes for insert to authenticated
  with check (member_id = (select auth.uid()));
create policy bikes_update_own on public.bikes for update to authenticated
  using (member_id = (select auth.uid())) with check (member_id = (select auth.uid()));
create policy bikes_delete_own on public.bikes for delete to authenticated
  using (member_id = (select auth.uid()));

drop policy if exists regos_write_own on public.bike_registrations;
drop policy if exists regos_insert_own on public.bike_registrations;
drop policy if exists regos_update_own on public.bike_registrations;
drop policy if exists regos_delete_own on public.bike_registrations;
create policy regos_insert_own on public.bike_registrations for insert to authenticated
  with check (exists (select 1 from public.bikes b where b.id = bike_id and b.member_id = (select auth.uid())));
create policy regos_update_own on public.bike_registrations for update to authenticated
  using (exists (select 1 from public.bikes b where b.id = bike_id and b.member_id = (select auth.uid())))
  with check (exists (select 1 from public.bikes b where b.id = bike_id and b.member_id = (select auth.uid())));
create policy regos_delete_own on public.bike_registrations for delete to authenticated
  using (exists (select 1 from public.bikes b where b.id = bike_id and b.member_id = (select auth.uid())));

drop policy if exists emergency_write_own on public.emergency_contacts;
drop policy if exists emergency_insert_own on public.emergency_contacts;
drop policy if exists emergency_update_own on public.emergency_contacts;
drop policy if exists emergency_delete_own on public.emergency_contacts;
create policy emergency_insert_own on public.emergency_contacts for insert to authenticated
  with check (member_id = (select auth.uid()));
create policy emergency_update_own on public.emergency_contacts for update to authenticated
  using (member_id = (select auth.uid())) with check (member_id = (select auth.uid()));
create policy emergency_delete_own on public.emergency_contacts for delete to authenticated
  using (member_id = (select auth.uid()));

-- chapters_manage allowed nothing (using false since the review fixes); with no write policy at all,
-- row level security refuses the same writes.
drop policy if exists chapters_manage on public.chapters;

-- Sponsors: one read policy for the keepers and the members.
drop policy if exists sponsors_for_board on public.sponsors;
drop policy if exists sponsors_for_members on public.sponsors;
drop policy if exists sponsors_read on public.sponsors;
create policy sponsors_read on public.sponsors for select to authenticated
  using (private.is_sponsor_keeper() or (private.is_approved_member() and archived_at is null));

-- 4. A primary key for budgets and fund_openings -----------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.fund_openings'::regclass and contype = 'p') then
    alter table public.fund_openings add column id bigint generated always as identity primary key;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.budgets'::regclass and contype = 'p') then
    alter table public.budgets add column id bigint generated always as identity primary key;
  end if;
end $$;
