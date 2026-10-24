// Generated from the live Supabase schema (Stage 1). Regenerate after changing migrations.

// Stage 5: meetings and votes
import type { AgendaItem, BallotChoice, Electorate, MeetingKind, Threshold } from '../domain/types';
import type { BusinessJson } from './businessLive';

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
        Row: { member_id: string; ride_reminders: boolean; ride_changes: boolean; new_rides: boolean; approvals: boolean; updated_at: string };
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
    };
    Views: { [_ in never]: never };
    Functions: {
      approve_member: { Args: { p_member: string; p_status: MemberStatus }; Returns: undefined };
      decline_member: { Args: { p_member: string }; Returns: undefined };
      set_member_status: { Args: { p_member: string; p_status: MemberStatus }; Returns: undefined };
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
      ride_calendar: {
        Args: never;
        Returns: {
          rides: Database['public']['Tables']['rides']['Row'][];
          rsvps: Database['public']['Tables']['rsvps']['Row'][];
          /** Missing for anyone who isn't an approved member. */
          crew?: Database['public']['Tables']['ride_crew']['Row'][];
          /** The routes of the rides shown (only rides that have one). Missing for anyone who isn't an approved member. */
          ride_routes?: { ride_id: string; route_id: string }[];
          synced_at: string | null;
        };
      };
      shared_phones: { Args: never; Returns: { member_id: string; phone: string }[] };
      claim_roster: { Args: never; Returns: boolean };
      appoint_position: { Args: { p_member: string; p_chapter: string | null; p_role: PositionRole }; Returns: string };
      end_position: { Args: { p_position: string }; Returns: undefined };
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
          p_closes_at: string;
        };
        Returns: string;
      };
      cast_ballot: { Args: { p_vote: string; p_choice: BallotChoice }; Returns: undefined };
      close_vote: { Args: { p_vote: string; p_casting: 'yes' | 'no' | null }; Returns: undefined };
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
      // Lane E: notifications
      register_push_device: { Args: { p_token: string; p_platform: string }; Returns: undefined };
      forget_push_device: { Args: { p_token: string }; Returns: undefined };
      save_notification_prefs: {
        Args: { p_ride_reminders: boolean; p_ride_changes: boolean; p_new_rides: boolean; p_approvals: boolean };
        Returns: undefined;
      };
    };
    Enums: {
      approval_state: ApprovalState;
      licence_class: LicenceClass;
      member_status: MemberStatus;
      position_role: PositionRole;
      crew_role: CrewRole;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
