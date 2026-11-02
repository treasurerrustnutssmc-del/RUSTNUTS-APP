-- Rustnuts app: LIVE database export, taken 2 Nov 2026 from the production Supabase project.
-- Structure and code only. No member data, no secret values. Read-only reference for auditors.
-- Row-level security policies, triggers, views, grants, storage bucket settings, realtime tables, extensions, scheduled jobs.

-- ===== ROW-LEVEL SECURITY POLICIES =====
create policy agms_read on public.agms as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy app_feedback_own_or_keeper on public.app_feedback as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR private.is_feedback_keeper()));

create policy attendance_read on public.attendance as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR private.sees_board_of(private.chapter_of(member_id)) OR private.is_auditor() OR (private.is_approved_member() AND private.is_approved(member_id) AND (EXISTS ( SELECT 1
   FROM checkin_sessions s
  WHERE ((s.id = attendance.session_id) AND (s.kind = 'ride'::text)))))));

create policy attendance_exemptions_read on public.attendance_exemptions as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR private.sees_board_of(private.chapter_of(member_id)) OR private.is_auditor()));

create policy big4_rides_read on public.big4_rides as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy big4_waivers_read on public.big4_waivers as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR private.sees_board_of(private.chapter_of(member_id))));

create policy regos_delete_own on public.bike_registrations as PERMISSIVE for DELETE to authenticated
  using ((EXISTS ( SELECT 1
   FROM bikes b
  WHERE ((b.id = bike_registrations.bike_id) AND (b.member_id = ( SELECT auth.uid() AS uid))))));

create policy regos_insert_own on public.bike_registrations as PERMISSIVE for INSERT to authenticated
  with check ((EXISTS ( SELECT 1
   FROM bikes b
  WHERE ((b.id = bike_registrations.bike_id) AND (b.member_id = ( SELECT auth.uid() AS uid))))));

create policy regos_read on public.bike_registrations as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM bikes b
  WHERE ((b.id = bike_registrations.bike_id) AND ((b.member_id = ( SELECT auth.uid() AS uid)) OR private.sees_board_of(private.chapter_of(b.member_id)))))));

create policy regos_update_own on public.bike_registrations as PERMISSIVE for UPDATE to authenticated
  using ((EXISTS ( SELECT 1
   FROM bikes b
  WHERE ((b.id = bike_registrations.bike_id) AND (b.member_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM bikes b
  WHERE ((b.id = bike_registrations.bike_id) AND (b.member_id = ( SELECT auth.uid() AS uid))))));

create policy bikes_delete_own on public.bikes as PERMISSIVE for DELETE to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));

create policy bikes_insert_own on public.bikes as PERMISSIVE for INSERT to authenticated
  with check ((member_id = ( SELECT auth.uid() AS uid)));

create policy bikes_read on public.bikes as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR (private.is_approved(member_id) AND private.is_approved_member()) OR private.sees_board_of(private.chapter_of(member_id))));

create policy bikes_update_own on public.bikes as PERMISSIVE for UPDATE to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)))
  with check ((member_id = ( SELECT auth.uid() AS uid)));

create policy brag_awards_for_members on public.brag_awards as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND (archived_at IS NULL)));

create policy brag_nominations_for_members on public.brag_nominations as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND (withdrawn_at IS NULL) AND (EXISTS ( SELECT 1
   FROM brag_awards a
  WHERE ((a.id = brag_nominations.award_id) AND (a.archived_at IS NULL))))));

create policy brag_votes_own on public.brag_votes as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND (member_id = ( SELECT auth.uid() AS uid))));

create policy build_updates_for_members on public.build_updates as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND (taken_down_at IS NULL) AND private.is_approved(author_id)));

create policy bus_bookings_for_members on public.bus_bookings as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy bus_costs_for_managers on public.bus_costs as PERMISSIVE for SELECT to authenticated
  using (private.can_read_bus_cost(logged_by));

create policy bus_key_handovers_for_members on public.bus_key_handovers as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy bus_km_for_members on public.bus_km as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy chapters_read on public.chapters as PERMISSIVE for SELECT to anon, authenticated
  using (true);

create policy charges_read on public.charges as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR private.can_see_fees(chapter_id)));

create policy charity_rides_for_members on public.charity_rides as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy charity_signups_for_members on public.charity_signups as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND ((member_id = ( SELECT auth.uid() AS uid)) OR private.runs_charity(ride_id) OR private.sees_board_of(private.chapter_of(member_id)))));

create policy chat_reads_own on public.chat_reads as PERMISSIVE for SELECT to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));

create policy checkin_sessions_read on public.checkin_sessions as PERMISSIVE for SELECT to authenticated
  using (private.can_check_in());

create policy club_history_for_members on public.club_history as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND (archived_at IS NULL)));

create policy club_honours_for_members on public.club_honours as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND (archived_at IS NULL)));

create policy club_invites_for_members on public.club_invites as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND (archived_at IS NULL)));

create policy continuation_fees_read on public.continuation_fees as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy conversation_members_read on public.conversation_members as PERMISSIVE for SELECT to authenticated
  using (private.can_read_chat(conversation_id));

create policy conversations_read on public.conversations as PERMISSIVE for SELECT to authenticated
  using (private.can_read_chat(id));

create policy crew_swaps_for_members on public.crew_swaps as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy emergency_delete_own on public.emergency_contacts as PERMISSIVE for DELETE to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));

create policy emergency_insert_own on public.emergency_contacts as PERMISSIVE for INSERT to authenticated
  with check ((member_id = ( SELECT auth.uid() AS uid)));

create policy emergency_read on public.emergency_contacts as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR private.sees_board_of(private.chapter_of(member_id))));

create policy emergency_update_own on public.emergency_contacts as PERMISSIVE for UPDATE to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)))
  with check ((member_id = ( SELECT auth.uid() AS uid)));

create policy fee_rates_read on public.fee_rates as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy hub_registrations_for_members on public.hub_registrations as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND ((member_id = ( SELECT auth.uid() AS uid)) OR private.manages_ride(ride_id) OR private.sees_board_of(private.chapter_of(member_id)))));

create policy listings_for_members on public.listings as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND (taken_down_at IS NULL) AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = listings.seller_id) AND (m.approval = 'approved'::approval_state))))));

create policy mechanic_vouches_for_members on public.mechanic_vouches as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = mechanic_vouches.member_id) AND (m.approval = 'approved'::approval_state))))));

create policy mechanics_for_members on public.mechanics as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy member_birthdays_for_members on public.member_birthdays as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = member_birthdays.member_id) AND (m.approval = 'approved'::approval_state))))));

create policy member_blocks_own on public.member_blocks as PERMISSIVE for SELECT to authenticated
  using ((blocker_id = ( SELECT auth.uid() AS uid)));

create policy member_decisions_read on public.member_decisions as PERMISSIVE for SELECT to authenticated
  using ((private.sees_board_of(private.chapter_of(member_id)) OR private.is_auditor()));

create policy private_read on public.member_private as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR private.sees_board_of(private.chapter_of(member_id))));

create policy private_update_self on public.member_private as PERMISSIVE for UPDATE to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)))
  with check ((member_id = ( SELECT auth.uid() AS uid)));

create policy member_skills_for_members on public.member_skills as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = member_skills.member_id) AND (m.approval = 'approved'::approval_state))))));

create policy members_read on public.members as PERMISSIVE for SELECT to authenticated
  using (((id = ( SELECT auth.uid() AS uid)) OR ((approval = 'approved'::approval_state) AND private.is_approved_member()) OR private.sees_board_of(chapter_id) OR private.is_auditor()));

create policy members_update_self on public.members as PERMISSIVE for UPDATE to authenticated
  using ((id = ( SELECT auth.uid() AS uid)))
  with check ((id = ( SELECT auth.uid() AS uid)));

create policy message_media_read on public.message_media as PERMISSIVE for SELECT to authenticated
  using ((private.can_read_chat(conversation_id) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_media.message_id) AND (m.removed_at IS NULL))))));

create policy message_reactions_read on public.message_reactions as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_reactions.message_id) AND private.can_read_chat(m.conversation_id)))));

create policy messages_read on public.messages as PERMISSIVE for SELECT to authenticated
  using (private.can_read_chat(conversation_id));

create policy notification_prefs_own on public.notification_prefs as PERMISSIVE for SELECT to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));

create policy other_clubs_for_members on public.other_clubs as PERMISSIVE for SELECT to authenticated
  using ((private.is_approved_member() AND (archived_at IS NULL)));

create policy payment_details_read on public.payment_details as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy payments_read on public.payments as PERMISSIVE for SELECT to authenticated
  using ((charge_id IN ( SELECT charges.id
   FROM charges)));

create policy positions_insert on public.positions as PERMISSIVE for INSERT to authenticated
  with check (false);

create policy positions_read on public.positions as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR private.is_approved_member()));

create policy positions_update on public.positions as PERMISSIVE for UPDATE to authenticated
  using (false)
  with check (false);

create policy ride_briefing_reads_for_members on public.ride_briefing_reads as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy ride_briefings_for_members on public.ride_briefings as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy ride_calls_for_members on public.ride_calls as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy ride_crew_for_members on public.ride_crew as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy ride_hubs_for_members on public.ride_hubs as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy ride_plans_for_members on public.ride_plans as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy ride_routes_for_members on public.ride_routes as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy rides_for_members on public.rides as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy road_rules_signoffs_for_members on public.road_rules_signoffs as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy road_rules_versions_for_members on public.road_rules_versions as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy route_ratings_for_members on public.route_ratings as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy routes_for_members on public.routes as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy rsvps_for_members on public.rsvps as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy site_enquiries_for_board on public.site_enquiries as PERMISSIVE for SELECT to authenticated
  using (private.sees_site_enquiry(chapter_slug));

create policy site_news_for_board on public.site_news as PERMISSIVE for SELECT to authenticated
  using (private.is_any_board());

create policy site_photo_crew_for_members on public.site_photo_crew as PERMISSIVE for SELECT to authenticated
  using (private.is_approved_member());

create policy site_photos_for_editors_and_posters on public.site_photos as PERMISSIVE for SELECT to authenticated
  using ((( SELECT private.is_site_photo_editor() AS is_site_photo_editor) OR (posted_by = ( SELECT auth.uid() AS uid))));

create policy sponsors_read on public.sponsors as PERMISSIVE for SELECT to authenticated
  using ((private.is_sponsor_keeper() OR (private.is_approved_member() AND (archived_at IS NULL))));

create policy status_changes_read on public.status_changes as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR private.sees_board_of(chapter_id) OR private.is_auditor()));

create policy status_notices_read on public.status_notices as PERMISSIVE for SELECT to authenticated
  using (((member_id = ( SELECT auth.uid() AS uid)) OR private.sees_board_of(chapter_id)));

create policy website_signups_for_organisers on public.website_signups as PERMISSIVE for SELECT to authenticated
  using (private.runs_charity(ride_id));

create policy brag_media_read on storage.objects as PERMISSIVE for SELECT to authenticated
  using (((bucket_id = 'brag-media'::text) AND private.can_read_brag_file(name)));

create policy brag_media_tidy on storage.objects as PERMISSIVE for DELETE to authenticated
  using (((bucket_id = 'brag-media'::text) AND (owner_id = (auth.uid())::text) AND (NOT private.brag_file_in_use(name))));

create policy brag_media_upload on storage.objects as PERMISSIVE for INSERT to authenticated
  with check (((bucket_id = 'brag-media'::text) AND (split_part(name, '/'::text, 1) = (auth.uid())::text) AND private.is_approved_member()));

create policy build_media_read on storage.objects as PERMISSIVE for SELECT to authenticated
  using (((bucket_id = 'build-media'::text) AND private.can_read_build_file(name)));

create policy build_media_tidy on storage.objects as PERMISSIVE for DELETE to authenticated
  using (((bucket_id = 'build-media'::text) AND (owner_id = (auth.uid())::text) AND (NOT private.build_file_in_use(name))));

create policy build_media_upload on storage.objects as PERMISSIVE for INSERT to authenticated
  with check (((bucket_id = 'build-media'::text) AND (split_part(name, '/'::text, 1) = (auth.uid())::text) AND private.is_approved_member()));

create policy chat_media_read on storage.objects as PERMISSIVE for SELECT to authenticated
  using (((bucket_id = 'chat-media'::text) AND private.can_read_chat_file(name, owner_id)));

create policy chat_media_tidy on storage.objects as PERMISSIVE for DELETE to authenticated
  using (((bucket_id = 'chat-media'::text) AND (owner_id = (auth.uid())::text) AND (NOT (EXISTS ( SELECT 1
   FROM message_media mm
  WHERE ((mm.path = objects.name) OR (mm.poster_path = objects.name)))))));

create policy chat_media_upload on storage.objects as PERMISSIVE for INSERT to authenticated
  with check (((bucket_id = 'chat-media'::text) AND private.can_upload_chat_file(name)));

create policy feedback_media_read on storage.objects as PERMISSIVE for SELECT to authenticated
  using (((bucket_id = 'feedback-media'::text) AND ((split_part(name, '/'::text, 1) = (auth.uid())::text) OR private.is_feedback_keeper())));

create policy feedback_media_tidy on storage.objects as PERMISSIVE for DELETE to authenticated
  using (((bucket_id = 'feedback-media'::text) AND (owner_id = (auth.uid())::text) AND (NOT private.feedback_file_in_use(name))));

create policy feedback_media_upload on storage.objects as PERMISSIVE for INSERT to authenticated
  with check (((bucket_id = 'feedback-media'::text) AND (split_part(name, '/'::text, 1) = (auth.uid())::text) AND private.uses_app()));

create policy shop_pictures_read on storage.objects as PERMISSIVE for SELECT to authenticated
  using (((bucket_id = 'shop-pictures'::text) AND private.runs_shop_pictures()));

create policy shop_pictures_tidy on storage.objects as PERMISSIVE for DELETE to authenticated
  using (((bucket_id = 'shop-pictures'::text) AND private.shop_picture_unused(name)));

create policy shop_pictures_upload on storage.objects as PERMISSIVE for INSERT to authenticated
  with check (((bucket_id = 'shop-pictures'::text) AND private.shop_picture_upload_ok(name)));

create policy site_media_read on storage.objects as PERMISSIVE for SELECT to authenticated
  using (((bucket_id = 'site-media'::text) AND ((split_part(name, '/'::text, 1) = (auth.uid())::text) OR private.is_site_photo_editor())));

create policy site_media_tidy on storage.objects as PERMISSIVE for DELETE to authenticated
  using (((bucket_id = 'site-media'::text) AND (split_part(name, '/'::text, 1) = (auth.uid())::text) AND (NOT (EXISTS ( SELECT 1
   FROM site_photos p
  WHERE ((p.bucket = 'site-media'::text) AND (p.path = objects.name)))))));

create policy site_media_upload on storage.objects as PERMISSIVE for INSERT to authenticated
  with check (((bucket_id = 'site-media'::text) AND (split_part(name, '/'::text, 1) = (auth.uid())::text) AND private.is_site_photo_editor()));

create policy sponsor_logos_read on storage.objects as PERMISSIVE for SELECT to anon, authenticated
  using (((bucket_id = 'sponsor-logos'::text) AND private.can_read_sponsor_logo(name)));

create policy sponsor_logos_tidy on storage.objects as PERMISSIVE for DELETE to authenticated
  using (((bucket_id = 'sponsor-logos'::text) AND (owner_id = (auth.uid())::text) AND (NOT private.sponsor_logo_in_use(name))));

create policy sponsor_logos_upload on storage.objects as PERMISSIVE for INSERT to authenticated
  with check (((bucket_id = 'sponsor-logos'::text) AND private.can_upload_sponsor_logo(name)));

create policy swap_media_read on storage.objects as PERMISSIVE for SELECT to authenticated
  using (((bucket_id = 'swap-media'::text) AND private.can_read_swap_file(name)));

create policy swap_media_tidy on storage.objects as PERMISSIVE for DELETE to authenticated
  using (((bucket_id = 'swap-media'::text) AND (owner_id = (auth.uid())::text) AND (NOT private.swap_file_in_use(name))));

create policy swap_media_upload on storage.objects as PERMISSIVE for INSERT to authenticated
  with check (((bucket_id = 'swap-media'::text) AND (split_part(name, '/'::text, 1) = (auth.uid())::text) AND private.is_approved_member()));

-- ===== TRIGGERS =====
CREATE TRIGGER forget_deleted_member AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION private.forget_deleted_user();
CREATE TRIGGER push_outbox_hold BEFORE INSERT ON private.push_outbox FOR EACH ROW EXECUTE FUNCTION private.push_hold_when_off();
CREATE TRIGGER app_feedback_push_answered AFTER UPDATE ON public.app_feedback FOR EACH ROW EXECUTE FUNCTION private.push_feedback_answered();
CREATE TRIGGER app_feedback_push_sent AFTER INSERT ON public.app_feedback FOR EACH ROW EXECUTE FUNCTION private.push_feedback_sent();
CREATE TRIGGER bikes_check BEFORE INSERT OR UPDATE ON public.bikes FOR EACH ROW EXECUTE FUNCTION private.check_bike();
CREATE TRIGGER refuse_forgotten BEFORE INSERT OR UPDATE ON public.bikes FOR EACH ROW EXECUTE FUNCTION private.refuse_forgotten();
CREATE TRIGGER posting_rules_nominations BEFORE INSERT ON public.brag_nominations FOR EACH ROW EXECUTE FUNCTION private.refuse_unagreed_post('nominated_by');
CREATE TRIGGER posting_rules_build_updates BEFORE INSERT ON public.build_updates FOR EACH ROW EXECUTE FUNCTION private.refuse_unagreed_post('author_id');
CREATE TRIGGER chapters_get_a_chat AFTER INSERT ON public.chapters FOR EACH ROW EXECUTE FUNCTION private.chapter_chat();
CREATE TRIGGER emergency_contacts_check BEFORE INSERT OR UPDATE ON public.emergency_contacts FOR EACH ROW EXECUTE FUNCTION private.check_contact();
CREATE TRIGGER refuse_forgotten BEFORE INSERT OR UPDATE ON public.emergency_contacts FOR EACH ROW EXECUTE FUNCTION private.refuse_forgotten();
CREATE TRIGGER posting_rules_listings BEFORE INSERT OR UPDATE OF title, details ON public.listings FOR EACH ROW EXECUTE FUNCTION private.refuse_unagreed_post('seller_id');
CREATE TRIGGER posting_rules_mechanics BEFORE INSERT OR UPDATE OF name, suburb, phone, website, speciality, notes ON public.mechanics FOR EACH ROW EXECUTE FUNCTION private.refuse_unagreed_post('added_by');
CREATE TRIGGER refuse_forgotten BEFORE INSERT OR UPDATE ON public.member_birthdays FOR EACH ROW EXECUTE FUNCTION private.refuse_forgotten();
CREATE TRIGGER member_private_forget_site_photos AFTER DELETE ON public.member_private FOR EACH ROW EXECUTE FUNCTION private.forget_site_photos();
CREATE TRIGGER refuse_forgotten BEFORE INSERT OR UPDATE ON public.member_private FOR EACH ROW EXECUTE FUNCTION private.refuse_forgotten();
CREATE TRIGGER refuse_forgotten BEFORE INSERT OR UPDATE ON public.member_skills FOR EACH ROW EXECUTE FUNCTION private.refuse_forgotten();
CREATE TRIGGER members_forget_feedback AFTER UPDATE OF account_deleted_on ON public.members FOR EACH ROW EXECUTE FUNCTION private.forget_feedback();
CREATE TRIGGER members_patch_in_fee AFTER UPDATE OF status ON public.members FOR EACH ROW WHEN (((new.status = 'full'::member_status) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION private.patch_in_fee();
CREATE TRIGGER members_push_applicant AFTER INSERT ON public.members FOR EACH ROW EXECUTE FUNCTION private.push_applicant();
CREATE TRIGGER posting_rules_bio BEFORE UPDATE OF bio ON public.members FOR EACH ROW EXECUTE FUNCTION private.refuse_unagreed_bio();
CREATE TRIGGER refuse_forgotten BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION private.refuse_forgotten_member();
CREATE CONSTRAINT TRIGGER messages_push AFTER INSERT ON public.messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.push_chat_message();
CREATE TRIGGER posting_rules_messages BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.refuse_unagreed_post('author_id');
CREATE TRIGGER site_photos_message_removed AFTER UPDATE OF removed_at ON public.messages FOR EACH ROW WHEN (((old.removed_at IS NULL) AND (new.removed_at IS NOT NULL))) EXECUTE FUNCTION private.site_photos_message_removed();
CREATE TRIGGER refuse_forgotten BEFORE INSERT OR UPDATE ON public.notification_prefs FOR EACH ROW EXECUTE FUNCTION private.refuse_forgotten();
CREATE TRIGGER refuse_forgotten BEFORE INSERT OR UPDATE ON public.push_devices FOR EACH ROW EXECUTE FUNCTION private.refuse_forgotten();
CREATE TRIGGER ride_alerts_push AFTER INSERT ON public.ride_alerts FOR EACH ROW EXECUTE FUNCTION private.push_ride_alert();
CREATE TRIGGER rides_get_a_chat AFTER INSERT ON public.rides FOR EACH ROW EXECUTE FUNCTION private.ride_chat_for_new_ride();
CREATE TRIGGER rides_push_added AFTER INSERT ON public.rides FOR EACH ROW EXECUTE FUNCTION private.push_ride_added();
CREATE TRIGGER rides_push_changed AFTER UPDATE ON public.rides FOR EACH ROW EXECUTE FUNCTION private.push_ride_changed();
CREATE TRIGGER site_photos_push_up AFTER INSERT ON public.site_photos FOR EACH ROW EXECUTE FUNCTION private.push_site_photo_up();
CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();
CREATE TRIGGER enforce_versioning_status_transition BEFORE UPDATE OF versioning_status ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_versioning_status_transition();
CREATE TRIGGER protect_bucket_control_insert BEFORE INSERT ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns('service_role');
CREATE TRIGGER protect_bucket_control_update BEFORE UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns();
CREATE TRIGGER protect_bucket_control_update_role AFTER UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_lifecycle_service_role('service_role');
CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();

-- ===== VIEWS =====
(none)

-- ===== TABLE GRANTS to anon / authenticated =====
public.agms: authenticated -> SELECT
public.app_feedback: authenticated -> SELECT
public.attendance: authenticated -> SELECT
public.attendance_exemptions: authenticated -> SELECT
public.big4_rides: authenticated -> SELECT
public.big4_waivers: authenticated -> SELECT
public.bike_registrations: authenticated -> DELETE,INSERT,SELECT,UPDATE
public.bikes: authenticated -> DELETE,INSERT,SELECT,UPDATE
public.brag_awards: authenticated -> SELECT
public.brag_nominations: authenticated -> SELECT
public.brag_votes: authenticated -> SELECT
public.build_updates: authenticated -> SELECT
public.bus_bookings: authenticated -> SELECT
public.bus_costs: authenticated -> SELECT
public.bus_key_handovers: authenticated -> SELECT
public.bus_km: authenticated -> SELECT
public.chapters: anon -> SELECT
public.chapters: authenticated -> SELECT
public.charges: authenticated -> SELECT
public.charity_rides: authenticated -> SELECT
public.charity_signups: authenticated -> SELECT
public.chat_reads: authenticated -> SELECT
public.club_history: authenticated -> SELECT
public.club_honours: authenticated -> SELECT
public.club_invites: authenticated -> SELECT
public.continuation_fees: authenticated -> SELECT
public.conversation_members: authenticated -> SELECT
public.conversations: authenticated -> SELECT
public.crew_swaps: authenticated -> SELECT
public.emergency_contacts: authenticated -> DELETE,INSERT,SELECT,UPDATE
public.fee_rates: authenticated -> SELECT
public.hub_registrations: authenticated -> SELECT
public.listings: authenticated -> SELECT
public.mechanic_vouches: authenticated -> SELECT
public.mechanics: authenticated -> SELECT
public.member_birthdays: authenticated -> SELECT
public.member_blocks: authenticated -> SELECT
public.member_decisions: authenticated -> SELECT
public.member_private: authenticated -> SELECT
public.member_skills: authenticated -> SELECT
public.members: authenticated -> SELECT
public.message_media: authenticated -> SELECT
public.message_reactions: authenticated -> SELECT
public.messages: authenticated -> SELECT
public.notification_prefs: authenticated -> SELECT
public.other_clubs: authenticated -> SELECT
public.payment_details: authenticated -> SELECT
public.payments: authenticated -> SELECT
public.positions: authenticated -> SELECT
public.ride_briefing_reads: authenticated -> SELECT
public.ride_briefings: authenticated -> SELECT
public.ride_calls: authenticated -> SELECT
public.ride_crew: authenticated -> SELECT
public.ride_hubs: authenticated -> SELECT
public.ride_plans: authenticated -> SELECT
public.ride_routes: authenticated -> SELECT
public.rides: authenticated -> SELECT
public.road_rules_signoffs: authenticated -> SELECT
public.road_rules_versions: authenticated -> SELECT
public.route_ratings: authenticated -> SELECT
public.rsvps: authenticated -> SELECT
public.site_enquiries: authenticated -> SELECT
public.site_news: authenticated -> SELECT
public.site_photo_crew: authenticated -> SELECT
public.site_photos: authenticated -> SELECT
public.sponsors: authenticated -> SELECT
public.status_changes: authenticated -> SELECT
public.status_notices: authenticated -> SELECT
public.website_signups: authenticated -> SELECT

-- ===== FUNCTION EXECUTE GRANTS (public/private schema; SECURITY DEFINER marked) =====
private.add_roster_position(p_member uuid, p_seat uuid, p_role position_role): anon=f authenticated=f
private.address_problem(p_street text, p_suburb text, p_state text, p_postcode text): anon=f authenticated=f
private.agm_on(p_year integer) [SECURITY DEFINER]: anon=f authenticated=t
private.approves_for(p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.assistant_next_month(p_day date): anon=f authenticated=f
private.assistant_on() [SECURITY DEFINER]: anon=f authenticated=f
private.assistant_setting(p_key text, p_default bigint) [SECURITY DEFINER]: anon=f authenticated=f
private.audit_draft(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.audit_text(p_text text, p_empty text, p_max integer): anon=f authenticated=f
private.award_phase(p_nominations_close date, p_voting_close date): anon=f authenticated=f
private.balance_before(p_chapter uuid, p_month date) [SECURITY DEFINER]: anon=f authenticated=f
private.big4_problem(p_member uuid, p_ride uuid, p_crew boolean) [SECURITY DEFINER]: anon=f authenticated=f
private.blocked_between(a uuid, b uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.brag_file_in_use(p_name text) [SECURITY DEFINER]: anon=f authenticated=t
private.build_file_in_use(p_name text) [SECURITY DEFINER]: anon=f authenticated=t
private.bus_clashes(p_first date, p_last date, p_except uuid): anon=f authenticated=f
private.bus_hand() [SECURITY DEFINER]: anon=f authenticated=f
private.bus_key_holder() [SECURITY DEFINER]: anon=f authenticated=f
private.can_act_on_content_report(p_report uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.can_act_on_report(p_report uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.can_change_invite(i club_invites) [SECURITY DEFINER]: anon=f authenticated=f
private.can_check_in() [SECURITY DEFINER]: anon=f authenticated=t
private.can_designate_big4() [SECURITY DEFINER]: anon=f authenticated=t
private.can_edit_mechanic(p_added_by uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.can_edit_other_club(p_added_by uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.can_manage_fees(target_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.can_moderate(p_chat uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.can_read_brag_file(p_name text) [SECURITY DEFINER]: anon=f authenticated=t
private.can_read_build_file(p_name text) [SECURITY DEFINER]: anon=f authenticated=t
private.can_read_bus_cost(p_logged_by uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.can_read_chat(p_chat uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.can_read_chat_file(p_name text, p_owner text) [SECURITY DEFINER]: anon=f authenticated=t
private.can_read_sponsor_logo(p_name text) [SECURITY DEFINER]: anon=t authenticated=t
private.can_read_swap_file(p_name text) [SECURITY DEFINER]: anon=f authenticated=t
private.can_run_checkin(target_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.can_see_fees(target_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.can_set_fees(target_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.can_upload_chat_file(p_name text) [SECURITY DEFINER]: anon=f authenticated=t
private.can_upload_sponsor_logo(p_name text) [SECURITY DEFINER]: anon=f authenticated=t
private.chair_of(p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.chapter_chat() [SECURITY DEFINER]: anon=f authenticated=f
private.chapter_name_taken(p_name text, p_except uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.chapter_of(target_member uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.chapters_represented(p_vote uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.chat_problem(p_chat uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.chat_push_body(m messages, c conversations, sender members) [SECURITY DEFINER]: anon=f authenticated=f
private.chat_push_title(c conversations, sender members) [SECURITY DEFINER]: anon=f authenticated=f
private.check_bike(): anon=f authenticated=t
private.check_bike_year(p_year integer): anon=f authenticated=t
private.check_club_on_list(p_club uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.check_contact(): anon=f authenticated=t
private.check_document_approval(p_body text, p_approved_on date, p_commences_on date) [SECURITY DEFINER]: anon=f authenticated=f
private.check_history_keeper() [SECURITY DEFINER]: anon=f authenticated=f
private.check_payment(c charges, p_amount_cents integer, p_paid_on date, p_method text, too_much text) [SECURITY DEFINER]: anon=f authenticated=f
private.check_sponsor_keeper() [SECURITY DEFINER]: anon=f authenticated=f
private.check_votes(p_for integer, p_against integer, p_abstained integer): anon=f authenticated=f
private.club_date(at_time timestamp with time zone): anon=f authenticated=t
private.club_day(t timestamp with time zone): anon=f authenticated=f
private.club_time(t timestamp with time zone): anon=f authenticated=f
private.club_year_of(d date) [SECURITY DEFINER]: anon=f authenticated=t
private.conduct_board_record(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.conduct_chapter(r conduct_records) [SECURITY DEFINER]: anon=f authenticated=f
private.conduct_delete_on(p_decided date, p_suspended date, p_hold date): anon=f authenticated=f
private.conduct_formal(p_kind text): anon=f authenticated=f
private.conduct_kept(r conduct_records) [SECURITY DEFINER]: anon=f authenticated=f
private.conduct_open_appeal(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.conduct_record(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.content_report_target(p_kind text, p_target uuid, OUT present boolean, OUT author uuid, OUT gone boolean, OUT snapshot text) [SECURITY DEFINER]: anon=f authenticated=f
private.contribution_shares(p_total integer) [SECURITY DEFINER]: anon=f authenticated=f
private.crew_eligibility(p_member uuid, p_role crew_role, ride_day date) [SECURITY DEFINER]: anon=f authenticated=f
private.cron_headers() [SECURITY DEFINER]: anon=f authenticated=f
private.cron_secret() [SECURITY DEFINER]: anon=f authenticated=f
private.decide(p_threshold vote_threshold, p_quorum integer, p_yes integer, p_no integer, p_abstain integer, p_casting text, p_electors integer, OUT result vote_result, OUT tied boolean): anon=f authenticated=f
private.design_problem(d shop_designs) [SECURITY DEFINER]: anon=f authenticated=f
private.document_in_force(p_document uuid, p_today date) [SECURITY DEFINER]: anon=f authenticated=f
private.electors_for(p_electorate electorate, p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.feedback_file_in_use(p_name text) [SECURITY DEFINER]: anon=f authenticated=t
private.fix_problem(p_lat double precision, p_lng double precision): anon=f authenticated=f
private.fng_due(p_member uuid, OUT at_months integer, OUT due_on date) [SECURITY DEFINER]: anon=f authenticated=t
private.forget_deleted_user() [SECURITY DEFINER]: anon=f authenticated=f
private.forget_feedback() [SECURITY DEFINER]: anon=f authenticated=f
private.forget_member(p_member uuid, p_email text) [SECURITY DEFINER]: anon=f authenticated=f
private.forget_site_photos() [SECURITY DEFINER]: anon=f authenticated=f
private.founders_problem(p_founders uuid[], p_president uuid, p_saa uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.fund_balance(p_chapter uuid, p_upto date) [SECURITY DEFINER]: anon=f authenticated=f
private.fy_of(d date): anon=f authenticated=t
private.has_carried_auditor_vote(p_member uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.has_carried_nec_vote(p_member uuid, p_role position_role) [SECURITY DEFINER]: anon=f authenticated=f
private.has_carried_patch_vote(p_member uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.has_carried_reinstate_vote(p_member uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.has_carried_removal_vote(p_position uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.hazards_ok(p_hazards text[]): anon=f authenticated=f
private.hold_problem(p_member uuid, p_role position_role) [SECURITY DEFINER]: anon=f authenticated=f
private.holds_board_seat(p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.is_any_board() [SECURITY DEFINER]: anon=f authenticated=t
private.is_approved(target_member uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.is_approved_member() [SECURITY DEFINER]: anon=f authenticated=t
private.is_auditor() [SECURITY DEFINER]: anon=f authenticated=t
private.is_board_of(target_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.is_chairman() [SECURITY DEFINER]: anon=f authenticated=t
private.is_family() [SECURITY DEFINER]: anon=f authenticated=t
private.is_feedback_keeper() [SECURITY DEFINER]: anon=f authenticated=t
private.is_learner(p_member uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.is_national() [SECURITY DEFINER]: anon=f authenticated=t
private.is_nec_officer() [SECURITY DEFINER]: anon=f authenticated=t
private.is_on_committee(p_committee chat_committee) [SECURITY DEFINER]: anon=f authenticated=f
private.is_on_this_day(p_day date, p_today date): anon=f authenticated=f
private.is_ride_leader(who uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.is_sharing(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.is_site_photo_editor() [SECURITY DEFINER]: anon=f authenticated=t
private.is_sponsor_keeper() [SECURITY DEFINER]: anon=f authenticated=t
private.keeps_books(p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.live_problem(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.live_ride_cleanup() [SECURITY DEFINER]: anon=f authenticated=f
private.live_window(r rides): anon=f authenticated=f
private.manages_bus() [SECURITY DEFINER]: anon=f authenticated=f
private.manages_chapter_rides(p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.manages_invite(i club_invites) [SECURITY DEFINER]: anon=f authenticated=f
private.manages_ride(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.manages_ride_category(p_category ride_category) [SECURITY DEFINER]: anon=f authenticated=t
private.manages_site_photo_crew() [SECURITY DEFINER]: anon=f authenticated=t
private.media_json(mm message_media, m messages): anon=f authenticated=f
private.meeting_for_action(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.meeting_report(p_from date, p_to date) [SECURITY DEFINER]: anon=f authenticated=f
private.member_can_read_chat(p_member uuid, p_chat uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.merch_item_run(p_item uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.merch_order(p_order uuid, OUT o merch_orders, OUT chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.min_quorum(p_electorate electorate, p_electors integer): anon=f authenticated=f
private.month_report(p_month date) [SECURITY DEFINER]: anon=f authenticated=f
private.nec_voter_for(p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.new_checkin_code(): anon=f authenticated=f
private.next_receipt(p_chapter uuid, p_fy integer) [SECURITY DEFINER]: anon=f authenticated=f
private.open_chapter_proposal(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.open_contribution(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.opening_on(p_chapter uuid, p_from date) [SECURITY DEFINER]: anon=f authenticated=f
private.owing(p_charge uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.patch_in_fee() [SECURITY DEFINER]: anon=f authenticated=f
private.posting_rules_agreed(p_member uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.pro_rata_cents(p_amount integer, p_months integer): anon=f authenticated=t
private.pro_rata_months(p_patched date, p_year integer) [SECURITY DEFINER]: anon=f authenticated=t
private.pro_rata_note(p_months integer): anon=f authenticated=t
private.purge_conduct() [SECURITY DEFINER]: anon=f authenticated=f
private.purge_url() [SECURITY DEFINER]: anon=f authenticated=f
private.push_applicant() [SECURITY DEFINER]: anon=f authenticated=f
private.push_chat_message() [SECURITY DEFINER]: anon=f authenticated=f
private.push_enabled() [SECURITY DEFINER]: anon=f authenticated=f
private.push_feedback_answered() [SECURITY DEFINER]: anon=f authenticated=f
private.push_feedback_sent() [SECURITY DEFINER]: anon=f authenticated=f
private.push_hold_when_off() [SECURITY DEFINER]: anon=f authenticated=f
private.push_ride_added() [SECURITY DEFINER]: anon=f authenticated=f
private.push_ride_alert() [SECURITY DEFINER]: anon=f authenticated=f
private.push_ride_changed() [SECURITY DEFINER]: anon=f authenticated=f
private.push_site_photo_up() [SECURITY DEFINER]: anon=f authenticated=f
private.push_url() [SECURITY DEFINER]: anon=f authenticated=f
private.raise_chat_problem(p_chat uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.reads_document(p_kind text) [SECURITY DEFINER]: anon=f authenticated=f
private.refuse_forgotten() [SECURITY DEFINER]: anon=f authenticated=f
private.refuse_forgotten_member() [SECURITY DEFINER]: anon=f authenticated=f
private.refuse_unagreed_bio() [SECURITY DEFINER]: anon=f authenticated=f
private.refuse_unagreed_post() [SECURITY DEFINER]: anon=f authenticated=f
private.remove_message_now(p_message uuid, p_by uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.require_auditor() [SECURITY DEFINER]: anon=f authenticated=f
private.require_books(p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.require_member() [SECURITY DEFINER]: anon=f authenticated=f
private.require_runs_shop() [SECURITY DEFINER]: anon=f authenticated=f
private.require_scope(p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.require_shop_seat() [SECURITY DEFINER]: anon=f authenticated=f
private.reviews_chapter(p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.reviews_scope(p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.ride_answers_close(ride rides): anon=f authenticated=f
private.ride_chat_for_new_ride() [SECURITY DEFINER]: anon=f authenticated=f
private.ride_day_end(p_starts timestamp with time zone): anon=f authenticated=f
private.ride_json(r rides): anon=f authenticated=f
private.ride_last_day(r rides): anon=f authenticated=f
private.ride_sync_url() [SECURITY DEFINER]: anon=f authenticated=f
private.road_rules_good_until(p_signed_at timestamp with time zone): anon=f authenticated=f
private.road_rules_signed(p_member uuid): anon=f authenticated=f
private.runs_charity(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.runs_scope(p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.runs_shop() [SECURITY DEFINER]: anon=f authenticated=f
private.runs_shop_pictures() [SECURITY DEFINER]: anon=f authenticated=t
private.sees_board_of(target_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=t
private.sees_conduct(r conduct_records) [SECURITY DEFINER]: anon=f authenticated=f
private.sees_ledger(p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.sees_merch_item(i merch_items) [SECURITY DEFINER]: anon=f authenticated=f
private.sees_merch_order(o merch_orders) [SECURITY DEFINER]: anon=f authenticated=f
private.sees_scope(p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.sees_shop_order(o shop_orders) [SECURITY DEFINER]: anon=f authenticated=f
private.sees_site_enquiry(target_slug text) [SECURITY DEFINER]: anon=f authenticated=t
private.shop_list_ok(p_list text[], p_max integer, p_max_length integer): anon=f authenticated=f
private.shop_order(p_order uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.shop_order_json(o shop_orders) [SECURITY DEFINER]: anon=f authenticated=f
private.shop_picture_unused(p_name text) [SECURITY DEFINER]: anon=f authenticated=t
private.shop_picture_upload_ok(p_name text) [SECURITY DEFINER]: anon=f authenticated=t
private.shop_seat() [SECURITY DEFINER]: anon=f authenticated=f
private.short_name(m members): anon=f authenticated=f
private.site_photos_message_removed() [SECURITY DEFINER]: anon=f authenticated=f
private.slug_of(p_name text): anon=f authenticated=f
private.sponsor_logo_in_use(p_name text) [SECURITY DEFINER]: anon=f authenticated=t
private.swap_file_in_use(p_name text) [SECURITY DEFINER]: anon=f authenticated=t
private.trim_like_app(p_text text): anon=f authenticated=f
private.uses_app() [SECURITY DEFINER]: anon=f authenticated=t
private.vote_used(p_vote uuid) [SECURITY DEFINER]: anon=f authenticated=f
private.website_on_bikes(p_ride uuid, p_except_email text): anon=f authenticated=f
private.writes_ride(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=f
public.accept_posting_rules() [SECURITY DEFINER]: anon=f authenticated=t
public.add_fee_payment(p_payment uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.add_shop_picture(p_design uuid, p_garment uuid, p_colour text, p_side text, p_path text) [SECURITY DEFINER]: anon=f authenticated=t
public.answer_app_feedback(p_id uuid, p_status text, p_reply text) [SECURITY DEFINER]: anon=f authenticated=t
public.answer_audit_request(p_id uuid, p_answer text) [SECURITY DEFINER]: anon=f authenticated=t
public.answer_invite(p_id uuid, p_answer text, p_label text, p_bikes numeric, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.answer_swap(p_swap uuid, p_yes boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.apply_ride_sync(p_feed uuid, p_events jsonb) [SECURITY DEFINER]: anon=f authenticated=f
public.apply_to_join(p_chapter uuid, p_full_name text, p_road_name text, p_phone text, p_introduced_by text, p_note text, p_status member_status, p_bike_make text, p_bike_model text, p_bike_year integer) [SECURITY DEFINER]: anon=f authenticated=t
public.appoint_position(p_member uuid, p_chapter uuid, p_role position_role) [SECURITY DEFINER]: anon=f authenticated=t
public.approve_budget(p_chapter uuid, p_fy integer, p_vote uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.approve_debit(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.approve_member(p_member uuid, p_status member_status) [SECURITY DEFINER]: anon=f authenticated=t
public.approve_minutes(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.archive_award(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.archive_history_entry(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.archive_honour(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.archive_invite(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.archive_mechanic(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.archive_other_club(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.archive_route(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.archive_sponsor(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.ask_swap(p_ride uuid, p_to uuid, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.assistant_spent(p_microusd bigint) [SECURITY DEFINER]: anon=f authenticated=f
public.assistant_start() [SECURITY DEFINER]: anon=f authenticated=t
public.assistant_status() [SECURITY DEFINER]: anon=f authenticated=t
public.book_bus(p_first date, p_last date, p_purpose bus_purpose, p_ride uuid, p_driver uuid, p_notes text) [SECURITY DEFINER]: anon=f authenticated=t
public.brag_tallies() [SECURITY DEFINER]: anon=f authenticated=t
public.call_ride(p_ride uuid, p_state ride_call_state, p_reason text, p_new_day date) [SECURITY DEFINER]: anon=f authenticated=t
public.cancel_bus(p_booking uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.cancel_meeting(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.cancel_merch_order(p_order uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.cancel_shop_order(p_order uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.cast_ballot(p_vote uuid, p_choice ballot_choice) [SECURITY DEFINER]: anon=f authenticated=t
public.cast_brag_vote(p_nomination uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.catchup_start(p_chat uuid, p_count integer) [SECURITY DEFINER]: anon=f authenticated=t
public.change_bus(p_booking uuid, p_first date, p_last date, p_purpose bus_purpose, p_ride uuid, p_driver uuid, p_notes text) [SECURITY DEFINER]: anon=f authenticated=t
public.chapter_of(target_member uuid) [SECURITY DEFINER]: anon=f authenticated=f
public.chat_list() [SECURITY DEFINER]: anon=f authenticated=t
public.chat_reports() [SECURITY DEFINER]: anon=f authenticated=t
public.check_in(p_code text) [SECURITY DEFINER]: anon=f authenticated=t
public.checkin_code(p_session uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.claim_payment(p_charge uuid, p_amount_cents integer, p_paid_on date, p_method text, p_reference text) [SECURITY DEFINER]: anon=f authenticated=t
public.claim_roster() [SECURITY DEFINER]: anon=f authenticated=t
public.close_audit_request(p_id uuid, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.close_checkin(p_session uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.close_merch(p_item uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.close_status_notice(p_notice uuid, p_outcome text, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.close_vote(p_vote uuid, p_casting text) [SECURITY DEFINER]: anon=f authenticated=t
public.club_admin() [SECURITY DEFINER]: anon=f authenticated=t
public.club_audit() [SECURITY DEFINER]: anon=f authenticated=t
public.club_business() [SECURITY DEFINER]: anon=f authenticated=t
public.club_documents() [SECURITY DEFINER]: anon=f authenticated=t
public.club_ledger() [SECURITY DEFINER]: anon=f authenticated=t
public.club_photos(p_before timestamp with time zone, p_limit integer) [SECURITY DEFINER]: anon=f authenticated=t
public.confirm_payment(p_payment uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.content_reports() [SECURITY DEFINER]: anon=f authenticated=t
public.create_document(p_chapter uuid, p_kind text, p_title text, p_asks_sign_off boolean, p_review_months integer) [SECURITY DEFINER]: anon=f authenticated=t
public.decide_application(p_member uuid, p_status member_status, p_for integer, p_against integer, p_abstained integer, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.decide_bus(p_booking uuid, p_yes boolean, p_reason text) [SECURITY DEFINER]: anon=f authenticated=t
public.decide_conduct_appeal(p_record uuid, p_outcome text, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.decide_contribution(p_id uuid, p_chapter uuid, p_vote uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.decide_merch(p_item uuid, p_yes boolean, p_reason text) [SECURITY DEFINER]: anon=f authenticated=t
public.decide_merch_order(p_order uuid, p_yes boolean, p_reason text) [SECURITY DEFINER]: anon=f authenticated=t
public.decline_member(p_member uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.delete_audit_report(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.delete_meeting_report(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.delete_my_account() [SECURITY DEFINER]: anon=f authenticated=t
public.designate_big4(p_ride uuid, p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.document_body(p_version uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.end_position(p_position uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.family_rides() [SECURITY DEFINER]: anon=f authenticated=t
public.forget_push_device(p_token text) [SECURITY DEFINER]: anon=f authenticated=t
public.give_status_notice(p_member uuid, p_about text, p_record text, p_proposal text, p_respond_by date) [SECURITY DEFINER]: anon=f authenticated=t
public.hand_bus_keys(p_to uuid, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.hand_over_merch_order(p_order uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.hand_over_shop_order(p_order uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.handle_site_enquiry(p_id uuid, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.hold_conduct(p_record uuid, p_until date, p_reason text) [SECURITY DEFINER]: anon=f authenticated=t
public.invite_club(p_ride uuid, p_club uuid, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.is_approved_member() [SECURITY DEFINER]: anon=f authenticated=f
public.issue_audit_report(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.leave_crew(p_ride uuid, p_member uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.link_preview(p_url text) [SECURITY DEFINER]: anon=f authenticated=t
public.list_app_feedback() [SECURITY DEFINER]: anon=f authenticated=t
public.list_site_enquiries(): anon=f authenticated=t
public.list_site_news(): anon=f authenticated=t
public.list_site_photos(): anon=f authenticated=t
public.list_sponsors() [SECURITY DEFINER]: anon=t authenticated=t
public.live_ride_state(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.lodge_conduct_appeal(p_record uuid, p_grounds text) [SECURITY DEFINER]: anon=f authenticated=t
public.log_bus_cost(p_on date, p_kind bus_cost_kind, p_cents integer, p_litres numeric, p_booking uuid, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.log_bus_km(p_km integer, p_on date, p_booking uuid, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.mark_attendance(p_session uuid, p_member uuid, p_present boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.mark_chat_read(p_chat uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.mark_document_reviewed(p_document uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.mark_listing_sold(p_id uuid, p_sold boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.meeting_reports() [SECURITY DEFINER]: anon=f authenticated=t
public.members_money(): anon=f authenticated=t
public.merch_catalogue() [SECURITY DEFINER]: anon=f authenticated=t
public.minutes_draft_start(p_meeting uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.my_open_reports() [SECURITY DEFINER]: anon=f authenticated=t
public.name_shop_runner(p_member uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.nominate(p_award uuid, p_ride uuid, p_title text, p_photo jsonb, p_story text, p_reason text) [SECURITY DEFINER]: anon=f authenticated=t
public.open_award(p_kind text, p_title text, p_year integer, p_nominations_close text, p_voting_close text) [SECURITY DEFINER]: anon=f authenticated=t
public.open_checkin(p_kind text, p_ride uuid, p_chapter uuid, p_title text, p_held_on date, p_meeting_type text) [SECURITY DEFINER]: anon=f authenticated=t
public.open_checkin(p_kind text, p_ride uuid, p_chapter uuid, p_title text, p_held_on date) [SECURITY DEFINER]: anon=f authenticated=t
public.open_direct_chat(p_member uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.open_vote(p_chapter uuid, p_meeting uuid, p_subject uuid, p_question text, p_details text, p_electorate electorate, p_threshold vote_threshold, p_secret boolean, p_quorum integer, p_closes_at timestamp with time zone, p_role position_role) [SECURITY DEFINER]: anon=f authenticated=t
public.order_merch(p_item uuid, p_size text, p_qty integer, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.pay_debit(p_id uuid, p_paid_on date) [SECURITY DEFINER]: anon=f authenticated=t
public.pay_merch_order(p_order uuid, p_paid_on date) [SECURITY DEFINER]: anon=f authenticated=t
public.pay_shop_order(p_order uuid, p_paid_on date, p_cents integer) [SECURITY DEFINER]: anon=f authenticated=t
public.photos_on_this_day() [SECURITY DEFINER]: anon=f authenticated=t
public.pick_site_photo(p_media uuid, p_caption text, p_consent boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.pin_message(p_chat uuid, p_message uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.place_shop_order(p_client_ref uuid, p_lines jsonb, p_email text, p_phone text, p_delivery text, p_street text, p_suburb text, p_state text, p_postcode text, p_shipping_method text, p_save_address boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.post_build_update(p_bike uuid, p_body text, p_photos jsonb) [SECURITY DEFINER]: anon=f authenticated=t
public.post_site_news(p_title text, p_body text, p_link text) [SECURITY DEFINER]: anon=f authenticated=t
public.present_meeting_report(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.present_report(p_month date) [SECURITY DEFINER]: anon=f authenticated=t
public.propose_chapter(p_name text, p_area text, p_state text, p_location text, p_membership text, p_leadership text, p_budget text, p_operations text, p_founders uuid[], p_president uuid, p_saa uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.propose_contribution(p_title text, p_purpose text, p_total_cents integer) [SECURITY DEFINER]: anon=f authenticated=t
public.propose_merch(p_chapter uuid, p_name text, p_details text, p_sizes text[], p_price_cents integer, p_patched_only boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.public_charity_rides() [SECURITY DEFINER]: anon=t authenticated=t
public.public_documents() [SECURITY DEFINER]: anon=t authenticated=t
public.public_rides() [SECURITY DEFINER]: anon=t authenticated=t
public.public_site_news() [SECURITY DEFINER]: anon=t authenticated=t
public.public_site_photos() [SECURITY DEFINER]: anon=t authenticated=t
public.publish_document_version(p_document uuid, p_expected integer, p_label text, p_body text, p_what_changed text, p_fresh_sign_off boolean, p_approving_body text, p_approved_on date, p_commences_on date) [SECURITY DEFINER]: anon=f authenticated=t
public.publish_road_rules(p_body text, p_changes text, p_fresh boolean, p_seen integer) [SECURITY DEFINER]: anon=f authenticated=t
public.purge_done(p_done bigint[], p_failed jsonb) [SECURITY DEFINER]: anon=f authenticated=f
public.purge_take(p_limit integer) [SECURITY DEFINER]: anon=f authenticated=f
public.push_done(p_sent bigint[], p_failed bigint[], p_dead_tokens text[]) [SECURITY DEFINER]: anon=f authenticated=f
public.push_take(p_limit integer) [SECURITY DEFINER]: anon=f authenticated=f
public.raise_audit_request(p_chapter uuid, p_kind text, p_area text, p_title text, p_details text, p_due date, p_ledger_entry uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.raise_charge(p_member uuid, p_description text, p_amount_cents integer, p_due_on date) [SECURITY DEFINER]: anon=f authenticated=t
public.raise_fees(p_chapter uuid, p_fy integer) [SECURITY DEFINER]: anon=f authenticated=t
public.raise_ride_alert(p_ride uuid, p_kind ride_alert_kind, p_lat double precision, p_lng double precision, p_at timestamp with time zone) [SECURITY DEFINER]: anon=f authenticated=t
public.rate_route(p_route uuid, p_stars integer, p_comment text) [SECURITY DEFINER]: anon=f authenticated=t
public.read_briefing(p_ride uuid, p_seen timestamp with time zone) [SECURITY DEFINER]: anon=f authenticated=t
public.record_agm(p_held_on date) [SECURITY DEFINER]: anon=f authenticated=t
public.record_conduct(p_member uuid, p_kind text, p_summary text, p_rule text, p_decided date, p_notice date, p_suspended date) [SECURITY DEFINER]: anon=f authenticated=t
public.record_credit(p_chapter uuid, p_code text, p_description text, p_amount_cents integer, p_received_on date, p_entry_on date) [SECURITY DEFINER]: anon=f authenticated=t
public.record_debit(p_chapter uuid, p_code text, p_description text, p_amount_cents integer, p_payee_member uuid, p_payee_name text, p_paid_on date) [SECURITY DEFINER]: anon=f authenticated=t
public.record_document_approval(p_version uuid, p_approving_body text, p_approved_on date, p_commences_on date) [SECURITY DEFINER]: anon=f authenticated=t
public.record_fng_review(p_member uuid, p_at_months integer, p_outcome text, p_for integer, p_against integer, p_abstained integer, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.record_payment(p_charge uuid, p_amount_cents integer, p_paid_on date, p_method text, p_reference text) [SECURITY DEFINER]: anon=f authenticated=t
public.record_ride_sync_error(p_feed uuid, p_error text) [SECURITY DEFINER]: anon=f authenticated=f
public.register_hub(p_ride uuid, p_staying hub_staying, p_pillion boolean, p_share_with text, p_notes text) [SECURITY DEFINER]: anon=f authenticated=t
public.register_push_device(p_token text, p_platform text) [SECURITY DEFINER]: anon=f authenticated=t
public.reject_payment(p_payment uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.remove_bike(p_bike uuid): anon=f authenticated=t
public.remove_conduct(p_record uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.remove_contact(p_contact uuid): anon=f authenticated=t
public.remove_message(p_message uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.remove_shop_picture(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.remove_site_news(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.remove_site_photo(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.remove_website_signup(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.renew_auditor() [SECURITY DEFINER]: anon=f authenticated=t
public.reopen_budget(p_chapter uuid, p_fy integer) [SECURITY DEFINER]: anon=f authenticated=t
public.report_content(p_kind text, p_target uuid, p_reason text) [SECURITY DEFINER]: anon=f authenticated=t
public.report_message(p_message uuid, p_reason text) [SECURITY DEFINER]: anon=f authenticated=t
public.resend_shop_order(p_order uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.resolve_content_report(p_report uuid, p_remove boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.resolve_report(p_report uuid, p_remove boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.resolve_ride_alert(p_alert uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.respond_to_notice(p_notice uuid, p_response text) [SECURITY DEFINER]: anon=f authenticated=t
public.restore_member_access(p_member uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.ride_calendar() [SECURITY DEFINER]: anon=f authenticated=t
public.ride_chat(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.ride_feeds_for_sync() [SECURITY DEFINER]: anon=f authenticated=f
public.ride_voice_room(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.ride_wall(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.ride_walls() [SECURITY DEFINER]: anon=f authenticated=t
public.route_gpx(p_route uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.save_action_item(p_id uuid, p_chapter uuid, p_meeting uuid, p_title text, p_owner uuid, p_due date) [SECURITY DEFINER]: anon=f authenticated=t
public.save_audit_report(p_id uuid, p_title text, p_from date, p_to date, p_findings text, p_recommendations text) [SECURITY DEFINER]: anon=f authenticated=t
public.save_bike(p_bike uuid, p_make text, p_model text, p_year integer, p_nickname text, p_is_project boolean, p_rego text, p_rego_expiry date): anon=f authenticated=t
public.save_briefing(p_ride uuid, p_hazards text[], p_changes text, p_notes text, p_seen timestamp with time zone) [SECURITY DEFINER]: anon=f authenticated=t
public.save_budget(p_chapter uuid, p_fy integer, p_lines jsonb) [SECURITY DEFINER]: anon=f authenticated=t
public.save_charity(p_ride uuid, p_cause text, p_about text, p_closes_on date, p_places integer, p_jobs text[], p_website boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.save_contact(p_contact uuid, p_name text, p_relationship text, p_phone text): anon=f authenticated=t
public.save_delivery_address(p_street text, p_suburb text, p_state text, p_postcode text) [SECURITY DEFINER]: anon=f authenticated=t
public.save_history_entry(p_id uuid, p_happened_on text, p_precision text, p_title text, p_story text) [SECURITY DEFINER]: anon=f authenticated=t
public.save_honour(p_id uuid, p_member uuid, p_name text, p_honour text, p_year integer, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.save_hub(p_ride uuid, p_members_only boolean, p_closes_on date, p_beds integer, p_accommodation text, p_notes text) [SECURITY DEFINER]: anon=f authenticated=t
public.save_invite_in(p_id uuid, p_club uuid, p_chapter uuid, p_title text, p_event_on text, p_place text, p_details text, p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.save_link_preview(p_url text, p_preview jsonb) [SECURITY DEFINER]: anon=f authenticated=f
public.save_listing(p_id uuid, p_kind text, p_title text, p_price numeric, p_details text, p_photos jsonb) [SECURITY DEFINER]: anon=f authenticated=t
public.save_mechanic(p_id uuid, p_name text, p_suburb text, p_phone text, p_website text, p_speciality text, p_notes text) [SECURITY DEFINER]: anon=f authenticated=t
public.save_meeting(p_id uuid, p_chapter uuid, p_kind meeting_kind, p_title text, p_starts_at timestamp with time zone, p_location text, p_agenda jsonb) [SECURITY DEFINER]: anon=f authenticated=t
public.save_meeting_report(p_id uuid, p_from date, p_to date, p_notes text) [SECURITY DEFINER]: anon=f authenticated=t
public.save_minutes(p_id uuid, p_text text) [SECURITY DEFINER]: anon=f authenticated=t
public.save_notification_prefs(p_ride_reminders boolean, p_ride_changes boolean, p_new_rides boolean, p_approvals boolean, p_rev_sound boolean, p_chat_messages boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.save_notification_prefs(p_ride_reminders boolean, p_ride_changes boolean, p_new_rides boolean, p_approvals boolean, p_rev_sound boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.save_notification_prefs(p_ride_reminders boolean, p_ride_changes boolean, p_new_rides boolean, p_approvals boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.save_other_club(p_id uuid, p_name text, p_town text, p_contact text, p_note text) [SECURITY DEFINER]: anon=f authenticated=t
public.save_profile(p_full_name text, p_road_name text, p_bio text, p_share_phone boolean, p_with_private boolean, p_email text, p_phone text, p_licence_class licence_class, p_licence_expiry date, p_first_aid_expiry date): anon=f authenticated=t
public.save_ride(p_id uuid, p_title text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_all_day boolean, p_category ride_category, p_location text, p_notes text, p_website boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.save_ride_plan(p_ride uuid, p_stops jsonb, p_seen timestamp with time zone) [SECURITY DEFINER]: anon=f authenticated=t
public.save_route(p_id uuid, p_name text, p_chapter uuid, p_notes text, p_gpx text, p_distance_m integer, p_climb_m integer, p_line jsonb, p_stops jsonb, p_bounds jsonb) [SECURITY DEFINER]: anon=f authenticated=t
public.save_sponsor(p_id uuid, p_name text, p_blurb text, p_url text, p_deal text, p_logo_path text, p_chapter uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.send_app_feedback(p_kind text, p_body text, p_where text, p_screenshot_path text, p_app_version text, p_build text, p_device text) [SECURITY DEFINER]: anon=f authenticated=t
public.send_message(p_chat uuid, p_body text, p_media jsonb, p_reply_to uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.set_action_done(p_id uuid, p_done boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.set_big4_waiver(p_ride uuid, p_member uuid, p_ground text) [SECURITY DEFINER]: anon=f authenticated=t
public.set_bike_range(p_bike uuid, p_range integer) [SECURITY DEFINER]: anon=f authenticated=t
public.set_birthday(p_month integer, p_day integer) [SECURITY DEFINER]: anon=f authenticated=t
public.set_block(p_member uuid, p_blocked boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.set_cash_float(p_fy integer, p_amount_cents integer) [SECURITY DEFINER]: anon=f authenticated=t
public.set_conduct_hearing(p_record uuid, p_panel uuid[], p_hearing date) [SECURITY DEFINER]: anon=f authenticated=t
public.set_crew(p_ride uuid, p_member uuid, p_role crew_role) [SECURITY DEFINER]: anon=f authenticated=t
public.set_exemption(p_session uuid, p_member uuid, p_reason text) [SECURITY DEFINER]: anon=f authenticated=t
public.set_fee_rate(p_chapter uuid, p_fy integer, p_status member_status, p_amount_cents integer, p_due_on date) [SECURITY DEFINER]: anon=f authenticated=t
public.set_meeting_type(p_session uuid, p_type text) [SECURITY DEFINER]: anon=f authenticated=t
public.set_member_status(p_member uuid, p_status member_status, p_by_request boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.set_opening(p_chapter uuid, p_fy integer, p_amount_cents integer) [SECURITY DEFINER]: anon=f authenticated=t
public.set_payment_details(p_chapter uuid, p_payid text, p_payid_name text, p_bsb text, p_account_no text) [SECURITY DEFINER]: anon=f authenticated=t
public.set_ride_called_off(p_id uuid, p_off boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.set_ride_route(p_ride uuid, p_route uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.set_rsvp(p_ride uuid, p_answer rsvp_answer) [SECURITY DEFINER]: anon=f authenticated=t
public.set_shop_design(p_id uuid, p_name text, p_eligibility text, p_blurb text, p_sort integer, p_on_sale boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.set_shop_garment(p_id uuid, p_design uuid, p_name text, p_price_cents integer, p_sizes text[], p_colours text[], p_sort integer, p_on_sale boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.set_shop_shipping(p_state text, p_method text, p_cents integer) [SECURITY DEFINER]: anon=f authenticated=t
public.set_site_photo_crew(p_member uuid, p_on boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.set_skills(p_skills text[]) [SECURITY DEFINER]: anon=f authenticated=t
public.settle_chapter_proposal(p_id uuid, p_vote uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.share_minutes(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.shared_phones() [SECURITY DEFINER]: anon=f authenticated=t
public.shop_order_sent(p_order uuid, p_ok boolean, p_error text) [SECURITY DEFINER]: anon=f authenticated=f
public.shop_orders() [SECURITY DEFINER]: anon=f authenticated=t
public.sign_document(p_version uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.sign_road_rules(p_version integer) [SECURITY DEFINER]: anon=f authenticated=t
public.sign_up_charity(p_ride uuid, p_riding boolean, p_pillion boolean, p_guests integer, p_guest_names text, p_job text, p_notes text) [SECURITY DEFINER]: anon=f authenticated=t
public.signup_counts() [SECURITY DEFINER]: anon=f authenticated=t
public.site_enquiry(p_name text, p_email text, p_chapter text, p_about text) [SECURITY DEFINER]: anon=f authenticated=f
public.site_visit(p_page text) [SECURITY DEFINER]: anon=f authenticated=f
public.site_visit_summary() [SECURITY DEFINER]: anon=f authenticated=t
public.start_live_ride(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.stop_live_ride(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.strike_bus_cost(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.strike_bus_km(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.suspend_member_access(p_member uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.take_down_build_update(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.take_down_listing(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.toggle_reaction(p_message uuid, p_emoji text) [SECURITY DEFINER]: anon=f authenticated=t
public.unclaimed_roster_counts() [SECURITY DEFINER]: anon=f authenticated=t
public.undesignate_big4(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.unname_shop_runner(p_member uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.update_live_position(p_ride uuid, p_lat double precision, p_lng double precision, p_accuracy real, p_heading real, p_speed real) [SECURITY DEFINER]: anon=f authenticated=t
public.upload_site_photo(p_path text, p_width integer, p_height integer, p_caption text, p_consent boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.void_entry(p_id uuid, p_reason text) [SECURITY DEFINER]: anon=f authenticated=t
public.vouch_mechanic(p_id uuid, p_on boolean) [SECURITY DEFINER]: anon=f authenticated=t
public.waive_charge(p_charge uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.website_signup(p_ride uuid, p_name text, p_email text, p_phone text, p_riding boolean, p_pillion boolean, p_guests integer, p_guest_names text, p_job text, p_notes text) [SECURITY DEFINER]: anon=f authenticated=f
public.withdraw_chapter_proposal(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.withdraw_charity(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.withdraw_conduct_appeal(p_record uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.withdraw_contribution(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.withdraw_hub(p_ride uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.withdraw_nomination(p_id uuid) [SECURITY DEFINER]: anon=f authenticated=t
public.withdraw_swap(p_swap uuid) [SECURITY DEFINER]: anon=f authenticated=t

-- ===== SCHEMA USAGE =====
public: anon usage=t, authenticated usage=t
private: anon usage=f, authenticated usage=t

-- ===== STORAGE BUCKETS (settings only) =====
brag-media: public=f, size_limit=10485760, mime={image/jpeg,image/png,image/webp}
build-media: public=f, size_limit=10485760, mime={image/jpeg,image/png,image/webp}
chat-media: public=f, size_limit=52428800, mime={image/jpeg,image/png,image/webp,video/mp4,video/quicktime,audio/mp4,audio/webm}
feedback-media: public=f, size_limit=10485760, mime={image/jpeg,image/png,image/webp}
shop-pictures: public=t, size_limit=5242880, mime={image/jpeg,image/png,image/webp}
site-media: public=f, size_limit=10485760, mime={image/jpeg,image/png,image/webp}
sponsor-logos: public=f, size_limit=5242880, mime={image/jpeg,image/png,image/webp}
swap-media: public=f, size_limit=10485760, mime={image/jpeg,image/png,image/webp}

-- ===== REALTIME PUBLICATION TABLES =====
public.messages

-- ===== EXTENSIONS =====
pg_cron 1.6.4 (schema pg_catalog)
pg_net 0.20.4 (schema extensions)
pg_stat_statements 1.11 (schema extensions)
pgcrypto 1.3 (schema extensions)
plpgsql 1.0 (schema pg_catalog)
supabase_vault 0.3.1 (schema vault)
uuid-ossp 1.1 (schema extensions)

-- ===== SCHEDULED JOBS (pg_cron; command text with any secret-looking value redacted) =====
live-ride-cleanup  [*/5 * * * *] active=t
  select private.live_ride_cleanup()

purge-conduct-records  [0 15 * * *] active=t
  select private.purge_conduct()

purge-files  [*/10 * * * *] active=t
  select net.http_post(url := u, headers := private.cron_headers(), body := '{}'::jsonb) from private.purge_url() as u where u is not null

push-outbox-cleanup  [17 3 * * *] active=t
  delete from private.push_outbox where created_at < now() - interval '90 days'

send-push  [* * * * *] active=t
  select net.http_post(url := u, headers := private.cron_headers(), body := '{}'::jsonb) from private.push_url() as u where u is not null

storage-purge-cleanup  [23 3 * * *] active=t
  delete from private.storage_purge where done_at < now() - interval '90 days'

sync-rides  [*/15 * * * *] active=t
  select net.http_post(url := u, headers := private.cron_headers(), body := '{}'::jsonb) from private.ride_sync_url() as u where u is not null

-- ===== VAULT SECRET NAMES (values never exported) =====
(none)