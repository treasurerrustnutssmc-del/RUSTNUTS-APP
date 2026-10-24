// Generated from the live Supabase schema (Stage 1). Regenerate after changing migrations.

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
  | 'founder';

type CrewRole = 'road_captain' | 'tail_gunner' | 'assistant_tail_gunner' | 'officer';
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
    };
    Views: { [_ in never]: never };
    Functions: {
      approve_member: { Args: { p_member: string; p_status: MemberStatus }; Returns: undefined };
      decline_member: { Args: { p_member: string }; Returns: undefined };
      set_member_status: { Args: { p_member: string; p_status: MemberStatus }; Returns: undefined };
      set_rsvp: { Args: { p_ride: string; p_answer: RsvpAnswer }; Returns: undefined };
      set_crew: { Args: { p_ride: string; p_member: string; p_role: CrewRole }; Returns: undefined };
      leave_crew: { Args: { p_ride: string; p_member: string }; Returns: undefined };
      ride_calendar: {
        Args: never;
        Returns: {
          rides: Database['public']['Tables']['rides']['Row'][];
          rsvps: Database['public']['Tables']['rsvps']['Row'][];
          /** Missing for anyone who isn't an approved member. */
          crew?: Database['public']['Tables']['ride_crew']['Row'][];
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
