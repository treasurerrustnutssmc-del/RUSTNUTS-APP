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
      // Stage 4: members and money
      members_money: { Args: never; Returns: MembersMoneyRows };
      open_checkin: {
        Args: { p_kind: string; p_ride: string | null; p_chapter: string | null; p_title: string | null; p_held_on: string | null };
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
      set_continuation_fee: { Args: { p_chapter: string; p_fy: number; p_amount_cents: number }; Returns: undefined };
      set_payment_details: {
        Args: { p_chapter: string; p_payid: string | null; p_payid_name: string | null; p_bsb: string | null; p_account_no: string | null };
        Returns: undefined;
      };
      raise_fees: { Args: { p_chapter: string; p_fy: number }; Returns: number };
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
