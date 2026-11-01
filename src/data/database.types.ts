// Generated from the live Supabase schema (Stage 1). Regenerate after changing migrations.

// Stage 5: meetings and votes
import type {
  AgendaItem, BallotChoice, Big4Ground, NoticeAbout, NoticeOutcome, BusCostKind, BusPurpose, BusStatus, Electorate, HubStaying, MeetingKind, MeetingType, PlanStop, RideCallState, SwapState, Threshold,
} from '../domain/types'; // HubStaying, PlanStop, RideCallState, SwapState: ride planning extras
import type { BusinessJson } from './businessLive';
import type { LedgerJson, MeetingReportJson } from './ledgerLive'; // Stage 5B
import type { AdminJson } from './adminLive'; // Stage 5D
import type { AuditJson } from './auditLive'; // National Auditor
import type { DocumentsJson } from './documentsLive'; // Stage 5C

type MemberStatus = 'introduced' | 'fng' | 'full' | 'nomad' | 'supporter' | 'family' | 'legacy';
type RideCategory = 'north' | 'west' | 'club' | 'supported' | 'non_nuts';
type RsvpAnswer = 'going' | 'maybe' | 'no';
type ApprovalState = 'pending' | 'approved' | 'declined' | 'suspended';
type LicenceClass = 'full_open' | 'probationary_open' | 'learner';
type PositionRole =
  | 'president'
  | 'vice_president'
  | 'secretary'
  | 'treasurer'
  | 'sergeant_at_arms'
  | 'road_captain'
  | 'officer'
  | 'tail_gunner'
  | 'social_media_officer'
  | 'club_coach'
  | 'nec_chair'
  | 'nec_secretary'
  | 'nec_auditor'
  | 'ride_committee'
  | 'assistant_tail_gunner'
  | 'founder'
  // Stage 3 (lane B)
  | 'charity_committee';

type CrewRole = 'road_captain' | 'tail_gunner' | 'assistant_tail_gunner' | 'officer';
type RouteLine = [number, number][];
type RouteStops = { name: string; lat: number; lng: number }[];
type RouteBounds = { minLat: number; minLng: number; maxLat: number; maxLng: number };
// Lane E: live ride
type RideAlertKind = 'emergency' | 'out' | 'regroup';
export type LiveStateJson = {
  me: { stops_at: string } | null;
  riders: {
    member_id: string;
    name: string;
    leader: boolean;
    lat: number | null;
    lng: number | null;
    accuracy_m: number | null;
    updated_at: string | null;
    phone: string | null;
  }[];
  alerts: {
    id: string;
    ride_id: string;
    member_id: string;
    kind: RideAlertKind;
    name: string;
    lat: number | null;
    lng: number | null;
    created_at: string;
    resolved_at: string | null;
    phone: string | null;
  }[];
  contacts: { id: string; member_id: string; name: string; relationship: string; phone: string }[];
};

export type Database = {
  __InternalSupabase: { PostgrestVersion: '14.18' };
  public: {
    Tables: {
      bike_registrations: {
        Row: { bike_id: string; rego: string | null; rego_expiry: string | null };
        Insert: { bike_id: string; rego?: string | null; rego_expiry?: string | null };
        Update: { bike_id?: string; rego?: string | null; rego_expiry?: string | null };
        Relationships: [];
      };
      bikes: {
        Row: {
          created_at: string;
          id: string;
          is_project: boolean;
          make: string;
          member_id: string;
          model: string;
          nickname: string | null;
          year: number | null;
          /** Ride planning extras; missing before that migration is live. */
          range_km?: number | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_project?: boolean;
          make: string;
          member_id: string;
          model: string;
          nickname?: string | null;
          year?: number | null;
        };
        Update: {
          is_project?: boolean;
          make?: string;
          model?: string;
          nickname?: string | null;
          year?: number | null;
        };
        Relationships: [];
      };
      chapters: {
        Row: { area: string; created_at: string; id: string; name: string; slug: string; state: string };
        Insert: { area: string; id?: string; name: string; slug: string; state?: string };
        Update: { area?: string; name?: string; slug?: string; state?: string };
        Relationships: [];
      };
      // Lane E: notifications
      notification_prefs: {
        Row: {
          member_id: string;
          ride_reminders: boolean;
          ride_changes: boolean;
          new_rides: boolean;
          approvals: boolean;
          /** Missing until rev-sound.sql is live. */
          rev_sound?: boolean;
          /** Missing until chat-push.sql is live. */
          chat_messages?: boolean;
          updated_at: string;
        };
        Insert: { member_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      emergency_contacts: {
        Row: { created_at: string; id: string; member_id: string; name: string; phone: string; relationship: string };
        Insert: { id?: string; member_id: string; name: string; phone: string; relationship: string };
        Update: { name?: string; phone?: string; relationship?: string };
        Relationships: [];
      };
      member_private: {
        Row: {
          application_note: string | null;
          email: string | null;
          first_aid_expiry: string | null;
          introduced_by: string | null;
          licence_class: LicenceClass | null;
          licence_expiry: string | null;
          member_id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: { member_id: string };
        Update: {
          email?: string | null;
          first_aid_expiry?: string | null;
          licence_class?: LicenceClass | null;
          licence_expiry?: string | null;
          phone?: string | null;
        };
        Relationships: [];
      };
      members: {
        Row: {
          applied_on: string;
          approval: ApprovalState;
          bio: string | null;
          chapter_id: string;
          created_at: string;
          fng_started_on: string | null;
          full_name: string;
          id: string;
          joined_on: string | null;
          on_hiatus: boolean;
          posting_rules_accepted_on: string | null;
          patched_on: string | null;
          road_name: string | null;
          share_phone: boolean;
          status: MemberStatus;
          updated_at: string;
        };
        Insert: { id: string; chapter_id: string; full_name: string };
        Update: { bio?: string | null; full_name?: string; road_name?: string | null; share_phone?: boolean };
        Relationships: [];
      };
      positions: {
        Row: {
          appointed_by: string | null;
          chapter_id: string | null;
          ended_by: string | null;
          ended_on: string | null;
          id: string;
          member_id: string;
          role: PositionRole;
          started_on: string;
        };
        Insert: { [_ in never]: never }; // positions change only through appoint_position / end_position
        Update: { [_ in never]: never };
        Relationships: [];
      };
      rides: {
        Row: {
          all_day: boolean;
          cancelled_at: string | null;
          category: RideCategory;
          ends_at: string | null;
          external_uid: string | null;
          feed_id: string | null;
          id: string;
          location: string | null;
          notes: string | null;
          source: 'feed' | 'app';
          starts_at: string;
          synced_at: string;
          title: string;
        };
        Insert: { [_ in never]: never }; // only the calendar sync writes rides
        Update: { [_ in never]: never };
        Relationships: [];
      };
      rsvps: {
        Row: { answer: RsvpAnswer; member_id: string; ride_id: string; updated_at: string };
        Insert: { [_ in never]: never }; // answers change only through set_rsvp
        Update: { [_ in never]: never };
        Relationships: [];
      };
      ride_crew: {
        Row: { assigned_at: string; assigned_by: string | null; member_id: string; ride_id: string; role: CrewRole };
        Insert: { [_ in never]: never }; // the crew changes only through set_crew and leave_crew
        Update: { [_ in never]: never };
        Relationships: [];
      };
      routes: {
        // Members can select every column but gpx (one route's file comes through route_gpx), so
        // name the columns: select('*') is refused.
        Row: {
          archived_at: string | null;
          bounds: RouteBounds | null;
          chapter_id: string | null;
          climb_m: number | null;
          created_at: string;
          created_by: string | null;
          distance_m: number;
          gpx: string;
          id: string;
          line: RouteLine;
          name: string;
          notes: string | null;
          stops: RouteStops;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: { [_ in never]: never }; // routes change only through save_route and archive_route
        Update: { [_ in never]: never };
        Relationships: [];
      };
      ride_routes: {
        Row: { ride_id: string; route_id: string | null; set_at: string; set_by: string | null };
        Insert: { [_ in never]: never }; // a ride's route changes only through set_ride_route
        Update: { [_ in never]: never };
        Relationships: [];
      };
      ride_briefings: {
        Row: {
          changes: string | null;
          hazards: string[];
          notes: string | null;
          ride_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: { [_ in never]: never }; // a briefing changes only through save_briefing
        Update: { [_ in never]: never };
        Relationships: [];
      };
      road_rules_versions: {
        Row: {
          body: string;
          changes: string | null;
          fresh: boolean;
          number: number;
          published_at: string;
          published_by: string | null;
        };
        Insert: { [_ in never]: never }; // versions are added only through publish_road_rules
        Update: { [_ in never]: never };
        Relationships: [];
      };
      bus_bookings: {
        Row: {
          id: string;
          first_day: string;
          last_day: string;
          purpose: BusPurpose;
          ride_id: string | null;
          driver_id: string | null;
          notes: string | null;
          status: BusStatus;
          booked_by: string | null;
          booked_at: string;
          decided_by: string | null;
          decided_at: string | null;
          decline_reason: string | null;
          cancelled_by: string | null;
          cancelled_at: string | null;
          // Rusty Bus extras
          changed_by: string | null;
          changed_at: string | null;
        };
        Insert: { [_ in never]: never }; // bookings change only through book_bus, decide_bus and cancel_bus
        Update: { [_ in never]: never };
        Relationships: [];
      };
      // Rusty Bus extras: each changes only through its actions.
      bus_key_handovers: {
        Row: { id: string; to_id: string | null; note: string | null; logged_by: string | null; logged_at: string };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      bus_km: {
        Row: {
          id: string; km: number; read_on: string; booking_id: string | null; note: string | null; logged_by: string | null;
          logged_at: string; struck_by: string | null; struck_at: string | null;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      bus_costs: {
        Row: {
          id: string; spent_on: string; kind: BusCostKind; amount_cents: number; litres: number | string | null; booking_id: string | null;
          note: string | null; logged_by: string | null; logged_at: string; struck_by: string | null; struck_at: string | null;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      // Ride planning extras: each changes only through its actions.
      ride_plans: {
        Row: { ride_id: string; stops: PlanStop[]; updated_by: string | null; updated_at: string };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      route_ratings: {
        Row: { route_id: string; member_id: string; stars: number; comment: string | null; rated_at: string };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      ride_calls: {
        Row: { ride_id: string; state: RideCallState; reason: string | null; new_day: string | null; called_by: string | null; called_at: string };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      ride_hubs: {
        Row: {
          ride_id: string; members_only: boolean; closes_on: string | null; beds: number | null; accommodation: string | null;
          notes: string | null; updated_by: string | null; updated_at: string;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      hub_registrations: {
        Row: {
          ride_id: string; member_id: string; staying: HubStaying; pillion: boolean; share_with: string | null; notes: string | null;
          registered_at: string; withdrawn_at: string | null;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      crew_swaps: {
        Row: {
          id: string; ride_id: string; asked_by: string; role: CrewRole; asked_to: string; their_role: CrewRole | null; note: string | null;
          state: SwapState; asked_at: string; answered_at: string | null;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      // Charity ride sign-ups
      charity_rides: {
        Row: {
          ride_id: string; cause: string; about: string | null; closes_on: string | null; places: number | null; jobs: string[];
          website: boolean; updated_by: string | null; updated_at: string;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      charity_signups: {
        Row: {
          ride_id: string; member_id: string; riding: boolean; pillion: boolean; guests: number; guest_names: string | null;
          job: string | null; notes: string | null; signed_at: string; withdrawn_at: string | null;
        };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      website_signups: {
        Row: {
          id: string; ride_id: string; name: string; email: string; phone: string | null; riding: boolean; pillion: boolean; guests: number;
          guest_names: string | null; job: string | null; notes: string | null; created_at: string; updated_at: string;
        };
        Insert: { [_ in never]: never }; // only through website_signup (the website's door, service role)
        Update: { [_ in never]: never };
        Relationships: [];
      };
      road_rules_signoffs: {
        Row: { member_id: string; signed_at: string; version: number };
        Insert: { [_ in never]: never }; // sign-offs are made only through sign_road_rules
        Update: { [_ in never]: never };
        Relationships: [];
      };
      ride_briefing_reads: {
        Row: { member_id: string; read_at: string; ride_id: string };
        Insert: { [_ in never]: never }; // reads are made only through read_briefing
        Update: { [_ in never]: never };
        Relationships: [];
      };
      // Attendance rules and Big 4 rides
      big4_rides: {
        Row: { ride_id: string; chapter_id: string | null; designated_by: string | null; designated_at: string };
        Insert: { [_ in never]: never }; // only through designate_big4 and undesignate_big4
        Update: { [_ in never]: never };
        Relationships: [];
      };
      attendance_exemptions: {
        Row: { session_id: string; member_id: string; reason: string; granted_by: string | null; granted_at: string };
        Insert: { [_ in never]: never }; // only through set_exemption
        Update: { [_ in never]: never };
        Relationships: [];
      };
      // Big 4 RSVP rules and the 5.5 notice
      big4_waivers: {
        Row: { ride_id: string; member_id: string; ground: Big4Ground; granted_by: string | null; granted_at: string };
        Insert: { [_ in never]: never }; // only through set_big4_waiver
        Update: { [_ in never]: never };
        Relationships: [];
      };
      status_notices: {
        Row: {
          id: string; member_id: string; chapter_id: string; about: NoticeAbout; record: string; proposal: string; given_on: string;
          respond_by: string; given_by: string | null; response: string | null; responded_at: string | null;
          outcome: NoticeOutcome | null; outcome_note: string | null; closed_on: string | null; closed_by: string | null;
        };
        Insert: { [_ in never]: never }; // only through give_status_notice, respond_to_notice and close_status_notice
        Update: { [_ in never]: never };
        Relationships: [];
      };
      status_changes: {
        Row: {
          id: string; member_id: string; chapter_id: string; from_status: MemberStatus; to_status: MemberStatus; by_request: boolean;
          notice_id: string | null; changed_by: string | null; changed_on: string; changed_at: string;
        };
        Insert: { [_ in never]: never }; // only through set_member_status
        Update: { [_ in never]: never };
        Relationships: [];
      };
      // Only the columns read directly; the rest come through members_money().
      checkin_sessions: {
        Row: { id: string; meeting_type: MeetingType | null };
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      approve_member: { Args: { p_member: string; p_status: MemberStatus }; Returns: undefined };
      decline_member: { Args: { p_member: string }; Returns: undefined };
      set_member_status: { Args: { p_member: string; p_status: MemberStatus; p_by_request?: boolean }; Returns: undefined };
      // Member content rules (App Store Guideline 1.2)
      accept_posting_rules: { Args: never; Returns: string };
      suspend_member_access: { Args: { p_member: string }; Returns: undefined };
      restore_member_access: { Args: { p_member: string }; Returns: undefined };
      set_rsvp: { Args: { p_ride: string; p_answer: RsvpAnswer }; Returns: undefined };
      set_crew: { Args: { p_ride: string; p_member: string; p_role: CrewRole }; Returns: undefined };
      leave_crew: { Args: { p_ride: string; p_member: string }; Returns: undefined };
      save_route: {
        Args: {
          p_id: string | null;
          p_name: string;
          p_chapter: string | null;
          p_notes: string | null;
          /** Null keeps the route's file and its summary. */
          p_gpx: string | null;
          p_distance_m: number | null;
          p_climb_m: number | null;
          p_line: RouteLine | null;
          p_stops: RouteStops | null;
          p_bounds: RouteBounds | null;
        };
        Returns: string;
      };
      archive_route: { Args: { p_id: string }; Returns: undefined };
      set_ride_route: { Args: { p_ride: string; p_route: string | null }; Returns: undefined };
      route_gpx: { Args: { p_route: string }; Returns: string };
      save_briefing: {
        Args: { p_ride: string; p_hazards: string[]; p_changes: string; p_notes: string; p_seen: string | null };
        Returns: undefined;
      };
      read_briefing: { Args: { p_ride: string; p_seen: string | null }; Returns: undefined };
      publish_road_rules: { Args: { p_body: string; p_changes: string; p_fresh: boolean; p_seen: number }; Returns: number };
      sign_road_rules: { Args: { p_version: number }; Returns: undefined };
      book_bus: {
        Args: {
          p_first: string | null;
          p_last: string | null;
          p_purpose: BusPurpose | null;
          p_ride: string | null;
          p_driver: string | null;
          p_notes: string | null;
        };
        Returns: string;
      };
      decide_bus: { Args: { p_booking: string; p_yes: boolean; p_reason: string | null }; Returns: undefined };
      cancel_bus: { Args: { p_booking: string }; Returns: undefined };
      // Rusty Bus extras
      change_bus: {
        Args: {
          p_booking: string;
          p_first: string | null;
          p_last: string | null;
          p_purpose: BusPurpose | null;
          p_ride: string | null;
          p_driver: string | null;
          p_notes: string | null;
        };
        Returns: undefined;
      };
      hand_bus_keys: { Args: { p_to: string | null; p_note: string | null }; Returns: string };
      log_bus_km: { Args: { p_km: number; p_on: string | null; p_booking: string | null; p_note: string | null }; Returns: string };
      log_bus_cost: {
        Args: { p_on: string | null; p_kind: BusCostKind | null; p_cents: number; p_litres: number | null; p_booking: string | null; p_note: string | null };
        Returns: string;
      };
      strike_bus_km: { Args: { p_id: string }; Returns: undefined };
      strike_bus_cost: { Args: { p_id: string }; Returns: undefined };
      // Attendance rules and Big 4 rides
      designate_big4: { Args: { p_ride: string; p_chapter: string | null }; Returns: undefined };
      undesignate_big4: { Args: { p_ride: string }; Returns: undefined };
      set_meeting_type: { Args: { p_session: string; p_type: MeetingType }; Returns: undefined };
      set_exemption: { Args: { p_session: string; p_member: string; p_reason: string | null }; Returns: undefined };
      set_big4_waiver: { Args: { p_ride: string; p_member: string; p_ground: Big4Ground | null }; Returns: undefined };
      give_status_notice: {
        Args: { p_member: string; p_about: string; p_record: string; p_proposal: string; p_respond_by: string };
        Returns: string;
      };
      respond_to_notice: { Args: { p_notice: string; p_response: string }; Returns: undefined };
      close_status_notice: { Args: { p_notice: string; p_outcome: NoticeOutcome; p_note: string }; Returns: undefined };
      // Ride planning extras
      set_bike_range: { Args: { p_bike: string; p_range: number | null }; Returns: undefined };
      save_ride_plan: { Args: { p_ride: string; p_stops: PlanStop[]; p_seen: string | null }; Returns: undefined };
      rate_route: { Args: { p_route: string; p_stars: number; p_comment: string | null }; Returns: undefined };
      call_ride: { Args: { p_ride: string; p_state: RideCallState; p_reason: string | null; p_new_day: string | null }; Returns: undefined };
      save_hub: {
        Args: { p_ride: string; p_members_only: boolean; p_closes_on: string | null; p_beds: number | null; p_accommodation: string | null; p_notes: string | null };
        Returns: undefined;
      };
      register_hub: {
        Args: { p_ride: string; p_staying: HubStaying; p_pillion: boolean; p_share_with: string | null; p_notes: string | null };
        Returns: undefined;
      };
      withdraw_hub: { Args: { p_ride: string }; Returns: undefined };
      // Charity ride sign-ups
      save_charity: {
        Args: {
          p_ride: string; p_cause: string; p_about: string | null; p_closes_on: string | null; p_places: number | null; p_jobs: string[];
          p_website: boolean;
        };
        Returns: undefined;
      };
      remove_website_signup: { Args: { p_id: string }; Returns: undefined };
      sign_up_charity: {
        Args: {
          p_ride: string; p_riding: boolean; p_pillion: boolean; p_guests: number; p_guest_names: string | null; p_job: string | null;
          p_notes: string | null;
        };
        Returns: undefined;
      };
      withdraw_charity: { Args: { p_ride: string }; Returns: undefined };
      ask_swap: { Args: { p_ride: string; p_to: string; p_note: string | null }; Returns: string };
      answer_swap: { Args: { p_swap: string; p_yes: boolean }; Returns: undefined };
      withdraw_swap: { Args: { p_swap: string }; Returns: undefined };
      ride_calendar: {
        Args: never;
        Returns: {
          rides: Database['public']['Tables']['rides']['Row'][];
          rsvps: Database['public']['Tables']['rsvps']['Row'][];
          /** Missing for anyone who isn't an approved member. */
          crew?: Database['public']['Tables']['ride_crew']['Row'][];
          /** The routes of the rides shown (only rides that have one). Missing for anyone who isn't an approved member. */
          ride_routes?: { ride_id: string; route_id: string }[];
          /** The briefings of the rides shown. Missing for anyone who isn't an approved member. */
          briefings?: Database['public']['Tables']['ride_briefings']['Row'][];
          /** Who has read which shown ride's briefing. Missing for anyone who isn't an approved member. */
          briefing_reads?: Database['public']['Tables']['ride_briefing_reads']['Row'][];
          synced_at: string | null;
        };
      };
      shared_phones: { Args: never; Returns: { member_id: string; phone: string }[] };
      claim_roster: { Args: never; Returns: boolean };
      /** Family view: the calendar from today on, ride columns only. Empty for anyone who isn't Family. */
      family_rides: {
        Args: never;
        Returns: Pick<
          Database['public']['Tables']['rides']['Row'],
          'id' | 'starts_at' | 'ends_at' | 'all_day' | 'title' | 'location' | 'notes' | 'category' | 'cancelled_at'
        >[];
      };
      unclaimed_roster_counts: { Args: never; Returns: { chapter_id: string; status: MemberStatus; n: number }[] };
      signup_counts: {
        Args: never;
        Returns: {
          ride_id: string; hub_riders: number; hub_pillions: number; hub_group: number; hub_own: number; hub_camping: number;
          hub_day: number; hub_group_beds: number; charity_riding: number; charity_pillions: number; charity_guests: number;
          charity_helping: number; charity_people: number;
          website_riding?: number; website_pillions?: number; website_guests?: number; website_helping?: number; website_people?: number; website_signups?: number;
        }[];
      };
      appoint_position: { Args: { p_member: string; p_chapter: string | null; p_role: PositionRole }; Returns: string };
      end_position: { Args: { p_position: string }; Returns: undefined };
      delete_my_account: { Args: never; Returns: undefined };
      // Ask the club (the club AI assistant)
      assistant_status: {
        Args: never;
        Returns: { on: boolean; left_today: number; daily_limit: number; resting_until: string | null; spent_microusd?: number; budget_microusd?: number; questions?: number };
      };
      apply_to_join: {
        Args: {
          p_chapter: string;
          p_full_name: string;
          p_road_name?: string;
          p_phone?: string;
          p_introduced_by?: string;
          p_note?: string;
          p_status?: MemberStatus;
          p_bike_make?: string;
          p_bike_model?: string;
          p_bike_year?: number;
        };
        Returns: undefined;
      };
      save_profile: {
        Args: {
          p_full_name: string;
          p_road_name: string | null;
          p_bio: string | null;
          p_share_phone: boolean;
          p_with_private?: boolean;
          p_email?: string | null;
          p_phone?: string | null;
          p_licence_class?: LicenceClass | null;
          p_licence_expiry?: string | null;
          p_first_aid_expiry?: string | null;
        };
        Returns: undefined;
      };
      save_bike: {
        Args: {
          p_bike: string | null;
          p_make: string;
          p_model: string;
          p_year: number | null;
          p_nickname: string | null;
          p_is_project: boolean;
          p_rego: string | null;
          p_rego_expiry: string | null;
        };
        Returns: string;
      };
      remove_bike: { Args: { p_bike: string }; Returns: undefined };
      save_contact: {
        Args: { p_contact: string | null; p_name: string; p_relationship: string; p_phone: string };
        Returns: string;
      };
      remove_contact: { Args: { p_contact: string }; Returns: undefined };
      // Stage 5: meetings and votes
      club_business: { Args: never; Returns: BusinessJson };
      save_meeting: {
        Args: {
          p_id: string | null; p_chapter: string | null; p_kind: MeetingKind; p_title: string; p_starts_at: string;
          p_location: string | null; p_agenda: AgendaItem[];
        };
        Returns: string;
      };
      cancel_meeting: { Args: { p_id: string }; Returns: undefined };
      save_minutes: { Args: { p_id: string; p_text: string }; Returns: undefined };
      approve_minutes: { Args: { p_id: string }; Returns: undefined };
      share_minutes: { Args: { p_id: string }; Returns: undefined };
      save_action_item: {
        Args: {
          p_id: string | null; p_chapter: string | null; p_meeting: string | null; p_title: string; p_owner: string;
          p_due: string | null;
        };
        Returns: string;
      };
      set_action_done: { Args: { p_id: string; p_done: boolean }; Returns: undefined };
      open_vote: {
        Args: {
          p_chapter: string | null; p_meeting: string | null; p_subject: string | null; p_question: string;
          p_details: string | null; p_electorate: Electorate; p_threshold: Threshold; p_secret: boolean; p_quorum: number;
          p_closes_at: string; p_role?: PositionRole;
        };
        Returns: string;
      };
      cast_ballot: { Args: { p_vote: string; p_choice: BallotChoice }; Returns: undefined };
      close_vote: { Args: { p_vote: string; p_casting: 'yes' | 'no' | 'decline' | null }; Returns: undefined };
      // Stage 5B: treasurer
      club_ledger: { Args: never; Returns: LedgerJson };
      meeting_reports: { Args: never; Returns: MeetingReportJson[] };
      // Stage 5D: board and admin
      club_admin: { Args: never; Returns: AdminJson };
      record_conduct: {
        Args: {
          p_member: string; p_kind: string | null; p_summary: string; p_rule: string; p_decided: string | null;
          p_notice: string | null; p_suspended: string | null;
        };
        Returns: string;
      };
      hold_conduct: { Args: { p_record: string; p_until: string | null; p_reason: string }; Returns: undefined };
      remove_conduct: { Args: { p_record: string }; Returns: undefined };
      lodge_conduct_appeal: { Args: { p_record: string; p_grounds: string }; Returns: undefined };
      set_conduct_hearing: { Args: { p_record: string; p_panel: string[]; p_hearing: string | null }; Returns: undefined };
      decide_conduct_appeal: { Args: { p_record: string; p_outcome: string; p_note: string }; Returns: undefined };
      withdraw_conduct_appeal: { Args: { p_record: string }; Returns: undefined };
      propose_merch: {
        Args: {
          p_chapter: string | null; p_name: string; p_details: string; p_sizes: string[]; p_price_cents: number; p_patched_only: boolean;
        };
        Returns: string;
      };
      decide_merch: { Args: { p_item: string; p_yes: boolean; p_reason: string }; Returns: undefined };
      close_merch: { Args: { p_item: string }; Returns: undefined };
      order_merch: { Args: { p_item: string; p_size: string | null; p_qty: number; p_note: string }; Returns: string };
      decide_merch_order: { Args: { p_order: string; p_yes: boolean; p_reason: string }; Returns: undefined };
      pay_merch_order: { Args: { p_order: string; p_paid_on: string }; Returns: string };
      hand_over_merch_order: { Args: { p_order: string }; Returns: undefined };
      cancel_merch_order: { Args: { p_order: string }; Returns: undefined };
      propose_contribution: { Args: { p_title: string; p_purpose: string; p_total_cents: number }; Returns: string };
      decide_contribution: { Args: { p_id: string; p_chapter: string; p_vote: string }; Returns: undefined };
      withdraw_contribution: { Args: { p_id: string }; Returns: undefined };
      propose_chapter: {
        Args: {
          p_name: string; p_area: string; p_state: string; p_location: string; p_membership: string; p_leadership: string;
          p_budget: string; p_operations: string; p_founders: string[]; p_president: string; p_saa: string;
        };
        Returns: string;
      };
      settle_chapter_proposal: { Args: { p_id: string; p_vote: string }; Returns: string | null };
      withdraw_chapter_proposal: { Args: { p_id: string }; Returns: undefined };
      // The National Auditor (11.8)
      club_audit: { Args: never; Returns: AuditJson };
      raise_audit_request: {
        Args: {
          p_chapter: string | null; p_kind: string; p_area: string; p_title: string; p_details: string; p_due: string | null;
          p_ledger_entry: string | null;
        };
        Returns: string;
      };
      answer_audit_request: { Args: { p_id: string; p_answer: string }; Returns: undefined };
      close_audit_request: { Args: { p_id: string; p_note: string }; Returns: undefined };
      save_audit_report: {
        Args: { p_id: string | null; p_title: string; p_from: string; p_to: string; p_findings: string; p_recommendations: string | null };
        Returns: string;
      };
      issue_audit_report: { Args: { p_id: string }; Returns: undefined };
      delete_audit_report: { Args: { p_id: string }; Returns: undefined };
      renew_auditor: { Args: never; Returns: string };
      record_credit: {
        Args: { p_chapter: string | null; p_code: string; p_description: string; p_amount_cents: number; p_received_on: string | null; p_entry_on: string };
        Returns: string;
      };
      record_debit: {
        Args: {
          p_chapter: string | null; p_code: string; p_description: string; p_amount_cents: number; p_payee_member: string | null;
          p_payee_name: string | null; p_paid_on: string | null;
        };
        Returns: string;
      };
      approve_debit: { Args: { p_id: string }; Returns: undefined };
      pay_debit: { Args: { p_id: string; p_paid_on: string }; Returns: undefined };
      void_entry: { Args: { p_id: string; p_reason: string }; Returns: undefined };
      add_fee_payment: { Args: { p_payment: string }; Returns: string };
      set_opening: { Args: { p_chapter: string | null; p_fy: number; p_amount_cents: number }; Returns: undefined };
      set_cash_float: { Args: { p_fy: number; p_amount_cents: number }; Returns: undefined };
      save_budget: { Args: { p_chapter: string | null; p_fy: number; p_lines: Partial<Record<string, number>> }; Returns: undefined };
      approve_budget: { Args: { p_chapter: string | null; p_fy: number; p_vote: string }; Returns: undefined };
      reopen_budget: { Args: { p_chapter: string | null; p_fy: number }; Returns: undefined };
      present_report: { Args: { p_month: string }; Returns: undefined };
      save_meeting_report: { Args: { p_id: string | null; p_from: string; p_to: string; p_notes: string }; Returns: string };
      present_meeting_report: { Args: { p_id: string }; Returns: undefined };
      delete_meeting_report: { Args: { p_id: string }; Returns: undefined };
      // Stage 5C: document library
      club_documents: { Args: never; Returns: DocumentsJson };
      document_body: { Args: { p_version: string }; Returns: string | null };
      create_document: {
        Args: { p_chapter: string | null; p_kind: string; p_title: string; p_asks_sign_off: boolean; p_review_months: number | null };
        Returns: string;
      };
      publish_document_version: {
        Args: {
          p_document: string; p_expected: number; p_label: string; p_body: string; p_what_changed: string; p_fresh_sign_off: boolean;
          p_approving_body: string | null; p_approved_on: string | null; p_commences_on: string | null;
        };
        Returns: string;
      };
      record_document_approval: {
        Args: { p_version: string; p_approving_body: string | null; p_approved_on: string | null; p_commences_on: string | null };
        Returns: undefined;
      };
      mark_document_reviewed: { Args: { p_document: string }; Returns: undefined };
      sign_document: { Args: { p_version: string }; Returns: undefined };
      // Lane E: live ride
      start_live_ride: { Args: { p_ride: string }; Returns: string };
      live_ride_state: { Args: { p_ride: string }; Returns: LiveStateJson };
      update_live_position: {
        Args: { p_ride: string; p_lat: number; p_lng: number; p_accuracy: number | null; p_heading: number | null; p_speed: number | null };
        Returns: LiveStateJson;
      };
      raise_ride_alert: {
        Args: { p_ride: string; p_kind: RideAlertKind; p_lat: number | null; p_lng: number | null; p_at?: string | null };
        Returns: string;
      };
      resolve_ride_alert: { Args: { p_alert: string }; Returns: undefined };
      stop_live_ride: { Args: { p_ride: string }; Returns: undefined };
      // Stage 4: members and money
      members_money: { Args: never; Returns: MembersMoneyRows };
      open_checkin: {
        Args: {
          p_kind: string; p_ride: string | null; p_chapter: string | null; p_title: string | null; p_held_on: string | null;
          /** Attendance rules: the six-argument version opens and classifies a meeting in one go. */
          p_meeting_type?: MeetingType;
        };
        Returns: string;
      };
      checkin_code: { Args: { p_session: string }; Returns: string };
      check_in: { Args: { p_code: string }; Returns: string };
      mark_attendance: { Args: { p_session: string; p_member: string; p_present: boolean }; Returns: undefined };
      close_checkin: { Args: { p_session: string }; Returns: undefined };
      decide_application: {
        Args: {
          p_member: string;
          p_status: MemberStatus | null;
          p_for: number | null;
          p_against: number | null;
          p_abstained: number | null;
          p_note: string | null;
        };
        Returns: undefined;
      };
      record_fng_review: {
        Args: {
          p_member: string;
          p_at_months: number;
          p_outcome: string;
          p_for: number | null;
          p_against: number | null;
          p_abstained: number | null;
          p_note: string | null;
        };
        Returns: undefined;
      };
      set_fee_rate: {
        Args: { p_chapter: string; p_fy: number; p_status: MemberStatus; p_amount_cents: number; p_due_on: string };
        Returns: undefined;
      };
      set_payment_details: {
        Args: { p_chapter: string; p_payid: string | null; p_payid_name: string | null; p_bsb: string | null; p_account_no: string | null };
        Returns: undefined;
      };
      raise_fees: { Args: { p_chapter: string; p_fy: number }; Returns: number };
      record_agm: { Args: { p_held_on: string }; Returns: undefined };
      raise_charge: { Args: { p_member: string; p_description: string; p_amount_cents: number; p_due_on: string }; Returns: string };
      waive_charge: { Args: { p_charge: string }; Returns: undefined };
      claim_payment: {
        Args: { p_charge: string; p_amount_cents: number; p_paid_on: string; p_method: string; p_reference: string | null };
        Returns: string;
      };
      record_payment: {
        Args: { p_charge: string; p_amount_cents: number; p_paid_on: string; p_method: string; p_reference: string | null };
        Returns: string;
      };
      confirm_payment: { Args: { p_payment: string }; Returns: undefined };
      reject_payment: { Args: { p_payment: string }; Returns: undefined };
      // Lane E: notifications
      register_push_device: { Args: { p_token: string; p_platform: string }; Returns: undefined };
      forget_push_device: { Args: { p_token: string }; Returns: undefined };
      save_notification_prefs: {
        Args:
          | {
              p_ride_reminders: boolean;
              p_ride_changes: boolean;
              p_new_rides: boolean;
              p_approvals: boolean;
              p_rev_sound: boolean;
              p_chat_messages: boolean;
            }
          | { p_ride_reminders: boolean; p_ride_changes: boolean; p_new_rides: boolean; p_approvals: boolean; p_rev_sound: boolean }
          | { p_ride_reminders: boolean; p_ride_changes: boolean; p_new_rides: boolean; p_approvals: boolean };
        Returns: undefined;
      };
    };
    Enums: {
      approval_state: ApprovalState;
      licence_class: LicenceClass;
      member_status: MemberStatus;
      position_role: PositionRole;
      crew_role: CrewRole;
      bus_purpose: BusPurpose;
      bus_status: BusStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

// Stage 4: what members_money() returns (rows as JSON, so dates are strings).
export type MembersMoneyRows = {
  sessions: {
    id: string;
    kind: 'ride' | 'meeting';
    chapter_id: string | null;
    ride_id: string | null;
    title: string;
    held_on: string;
    opened_by: string | null;
    closed_at: string | null;
  }[];
  attendance: { session_id: string; member_id: string; checked_in_at: string; marked_by: string | null }[];
  decisions: {
    id: string;
    member_id: string;
    kind: 'application' | 'fng_review';
    at_months: number | null;
    outcome: 'approved' | 'declined' | 'continue' | 'patch' | 'not_continuing';
    status: MemberStatus | null;
    votes_for: number | null;
    votes_against: number | null;
    votes_abstained: number | null;
    note: string | null;
    decided_on: string;
    recorded_by: string | null;
  }[];
  rates: { chapter_id: string; fy: number; status: MemberStatus; amount_cents: number; due_on: string }[];
  /** Club-year fees (added 25 Oct 2026); missing before that migration is live. */
  agms?: { year: number; held_on: string }[];
  continuation: { chapter_id: string; fy: number; amount_cents: number }[];
  charges: {
    id: string;
    member_id: string;
    chapter_id: string;
    fy: number;
    kind: 'annual' | 'continuation' | 'other';
    description: string | null;
    amount_cents: number;
    due_on: string;
    created_at: string;
    waived_at: string | null;
  }[];
  payments: {
    id: string;
    charge_id: string;
    amount_cents: number;
    paid_on: string;
    method: 'payid' | 'bank' | 'cash' | 'card';
    reference: string | null;
    state: 'claimed' | 'confirmed' | 'rejected';
    claimed_by: string | null;
    receipt_no: string | null;
    decided_at: string | null;
  }[];
  details: { chapter_id: string; payid: string | null; payid_name: string | null; bsb: string | null; account_no: string | null }[];
};
