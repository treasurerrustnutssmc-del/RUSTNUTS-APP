// Generated from the live Supabase schema (Stage 1). Regenerate after changing migrations.

type MemberStatus = 'introduced' | 'fng' | 'full' | 'nomad' | 'supporter' | 'family';
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
          patched_on: string | null;
          road_name: string | null;
          share_phone: boolean;
          on_hiatus: boolean;
          status: MemberStatus;
          updated_at: string;
        };
        Insert: { id: string; chapter_id: string; full_name: string };
        Update: { bio?: string | null; full_name?: string; road_name?: string | null; share_phone?: boolean };
        Relationships: [];
      };
      positions: {
        Row: {
          chapter_id: string | null;
          ended_on: string | null;
          id: string;
          member_id: string;
          role: PositionRole;
          started_on: string;
        };
        Insert: {
          chapter_id?: string | null;
          ended_on?: string | null;
          id?: string;
          member_id: string;
          role: PositionRole;
          started_on?: string;
        };
        Update: { ended_on?: string | null };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      approve_member: { Args: { p_member: string; p_status: MemberStatus }; Returns: undefined };
      decline_member: { Args: { p_member: string }; Returns: undefined };
      member_phone: { Args: { p_member: string }; Returns: string };
      set_member_status: { Args: { p_member: string; p_status: MemberStatus }; Returns: undefined };
      shared_phones: { Args: never; Returns: { member_id: string; phone: string }[] };
      submit_application: {
        Args: {
          p_chapter: string;
          p_full_name: string;
          p_introduced_by?: string;
          p_note?: string;
          p_phone?: string;
          p_road_name?: string;
          p_status?: MemberStatus;
        };
        Returns: undefined;
      };
    };
    Enums: {
      approval_state: ApprovalState;
      licence_class: LicenceClass;
      member_status: MemberStatus;
      position_role: PositionRole;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
