export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      files: {
        Row: {
          bucket_id: string
          completed_at: string | null
          content_type: string
          created_at: string
          deleted_at: string | null
          id: string
          node_id: number | null
          object_path: string
          original_name: string
          owner_user_id: string
          purpose: string
          room_id: number | null
          size_bytes: number
          status: string
          submission_id: number | null
        }
        Insert: {
          bucket_id?: string
          completed_at?: string | null
          content_type: string
          created_at?: string
          deleted_at?: string | null
          id: string
          node_id?: number | null
          object_path: string
          original_name: string
          owner_user_id: string
          purpose: string
          room_id?: number | null
          size_bytes: number
          status?: string
          submission_id?: number | null
        }
        Update: {
          bucket_id?: string
          completed_at?: string | null
          content_type?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          node_id?: number | null
          object_path?: string
          original_name?: string
          owner_user_id?: string
          purpose?: string
          room_id?: number | null
          size_bytes?: number
          status?: string
          submission_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "files_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "goal_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_nodes: {
        Row: {
          archived_at: string | null
          created_at: string
          depth: number
          description_md: string
          end_date: string
          id: number
          label: string | null
          parent_id: number | null
          room_id: number
          round_id: number | null
          sort_order: number
          start_date: string
          task_type: string | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          depth: number
          description_md?: string
          end_date: string
          id?: never
          label?: string | null
          parent_id?: number | null
          room_id: number
          round_id?: number | null
          sort_order: number
          start_date: string
          task_type?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          depth?: number
          description_md?: string
          end_date?: string
          id?: never
          label?: string | null
          parent_id?: number | null
          room_id?: number
          round_id?: number | null
          sort_order?: number
          start_date?: string
          task_type?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "goal_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_nodes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_nodes_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "goal_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_outbox: {
        Row: {
          attempts: number
          created_at: string
          id: number
          model: Json
          next_try_at: string
          sent_at: string | null
          status: string
          template: string
          to_email: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: never
          model: Json
          next_try_at?: string
          sent_at?: string | null
          status?: string
          template: string
          to_email: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: never
          model?: Json
          next_try_at?: string
          sent_at?: string | null
          status?: string
          template?: string
          to_email?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mail_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_user_id: string | null
          body: string | null
          created_at: string
          dedupe_key: string | null
          id: number
          kind: string
          link: string
          node_id: number | null
          read_at: string | null
          room_id: number | null
          title: string
          user_id: string
        }
        Insert: {
          actor_user_id?: string | null
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: never
          kind: string
          link: string
          node_id?: number | null
          read_at?: string | null
          room_id?: number | null
          title: string
          user_id: string
        }
        Update: {
          actor_user_id?: string | null
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: never
          kind?: string
          link?: string
          node_id?: number | null
          read_at?: string | null
          room_id?: number | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "goal_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_tone: string
          created_at: string
          email: string
          id: string
          last_login_at: string | null
          nickname: string | null
          nickname_normalized: string | null
          optional_mail_enabled: boolean
        }
        Insert: {
          avatar_tone: string
          created_at?: string
          email: string
          id: string
          last_login_at?: string | null
          nickname?: string | null
          nickname_normalized?: string | null
          optional_mail_enabled?: boolean
        }
        Update: {
          avatar_tone?: string
          created_at?: string
          email?: string
          id?: string
          last_login_at?: string | null
          nickname?: string | null
          nickname_normalized?: string | null
          optional_mail_enabled?: boolean
        }
        Relationships: []
      }
      room_invites: {
        Row: {
          created_at: string
          created_by: string
          revoked_at: string | null
          room_id: number
          token: string
        }
        Insert: {
          created_at?: string
          created_by: string
          revoked_at?: string | null
          room_id: number
          token: string
        }
        Update: {
          created_at?: string
          created_by?: string
          revoked_at?: string | null
          room_id?: number
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_invites_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_members: {
        Row: {
          applied_at: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: number
          joined_at: string | null
          left_at: string | null
          role: string
          room_id: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: never
          joined_at?: string | null
          left_at?: string | null
          role: string
          room_id: number
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: never
          joined_at?: string | null
          left_at?: string | null
          role?: string
          room_id?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_members_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_members_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      room_notification_settings: {
        Row: {
          completion_mode: string
          reminder_d1: boolean
          reminder_d3: boolean
          room_id: number
          room_start_end: boolean
          schedule_changed: boolean
          task_assigned: boolean
        }
        Insert: {
          completion_mode?: string
          reminder_d1?: boolean
          reminder_d3?: boolean
          room_id: number
          room_start_end?: boolean
          schedule_changed?: boolean
          task_assigned?: boolean
        }
        Update: {
          completion_mode?: string
          reminder_d1?: boolean
          reminder_d3?: boolean
          room_id?: number
          room_start_end?: boolean
          schedule_changed?: boolean
          task_assigned?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "room_notification_settings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_tag_suppressions: {
        Row: {
          room_id: number
          tag_slug: string
        }
        Insert: {
          room_id: number
          tag_slug: string
        }
        Update: {
          room_id?: number
          tag_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_tag_suppressions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_tag_suppressions_tag_slug_fkey"
            columns: ["tag_slug"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["slug"]
          },
        ]
      }
      room_tags: {
        Row: {
          created_at: string
          room_id: number
          sort_order: number
          source: string
          tag_slug: string
        }
        Insert: {
          created_at?: string
          room_id: number
          sort_order?: number
          source: string
          tag_slug: string
        }
        Update: {
          created_at?: string
          room_id?: number
          sort_order?: number
          source?: string
          tag_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_tags_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_tags_tag_slug_fkey"
            columns: ["tag_slug"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["slug"]
          },
        ]
      }
      rooms: {
        Row: {
          archived_at: string | null
          cover_file_id: string | null
          created_at: string
          description_md: string
          end_date: string
          ended_at: string | null
          id: number
          intro: string
          join_mode: string
          leader_does_tasks: boolean
          leader_id: string
          max_members: number
          member_count: number
          min_members: number | null
          rules_md: string
          slug: string
          start_date: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          archived_at?: string | null
          cover_file_id?: string | null
          created_at?: string
          description_md?: string
          end_date: string
          ended_at?: string | null
          id?: never
          intro: string
          join_mode: string
          leader_does_tasks?: boolean
          leader_id: string
          max_members: number
          member_count?: number
          min_members?: number | null
          rules_md?: string
          slug: string
          start_date: string
          started_at?: string | null
          status?: string
          title: string
          updated_at?: string
          visibility: string
        }
        Update: {
          archived_at?: string | null
          cover_file_id?: string | null
          created_at?: string
          description_md?: string
          end_date?: string
          ended_at?: string | null
          id?: never
          intro?: string
          join_mode?: string
          leader_does_tasks?: boolean
          leader_id?: string
          max_members?: number
          member_count?: number
          min_members?: number | null
          rules_md?: string
          slug?: string
          start_date?: string
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_rooms_cover"
            columns: ["cover_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_links: {
        Row: {
          id: number
          sort_order: number
          submission_id: number
          url: string
        }
        Insert: {
          id?: never
          sort_order: number
          submission_id: number
          url: string
        }
        Update: {
          id?: never
          sort_order?: number
          submission_id?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_links_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          body_md: string
          first_submitted_at: string
          id: number
          is_late: boolean
          node_id: number
          updated_at: string
          user_id: string
        }
        Insert: {
          body_md?: string
          first_submitted_at: string
          id?: never
          is_late: boolean
          node_id: number
          updated_at?: string
          user_id: string
        }
        Update: {
          body_md?: string
          first_submitted_at?: string
          id?: never
          is_late?: boolean
          node_id?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "goal_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          aliases: string[]
          kind: string
          label: string
          slug: string
          tone: string
          usage_count: number
        }
        Insert: {
          aliases?: string[]
          kind?: string
          label: string
          slug: string
          tone: string
          usage_count?: number
        }
        Update: {
          aliases?: string[]
          kind?: string
          label?: string
          slug?: string
          tone?: string
          usage_count?: number
        }
        Relationships: []
      }
      task_assignments: {
        Row: {
          assigned_at: string
          id: number
          node_id: number
          released_at: string | null
          source: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          id?: never
          node_id: number
          released_at?: string | null
          source: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          id?: never
          node_id?: number
          released_at?: string | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignments_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "goal_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      public_profiles: {
        Row: {
          avatar_tone: string | null
          id: string | null
          nickname: string | null
        }
        Insert: {
          avatar_tone?: string | null
          id?: string | null
          nickname?: string | null
        }
        Update: {
          avatar_tone?: string | null
          id?: string | null
          nickname?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_read_room: { Args: { p_room: number }; Returns: boolean }
      can_read_submission: {
        Args: { p_author: string; p_node: number }
        Returns: boolean
      }
      can_read_submissions: { Args: { p_room: number }; Returns: boolean }
      current_user_id: { Args: never; Returns: string }
      fail: {
        Args: { p_code: string; p_detail: string; p_hint?: Json }
        Returns: undefined
      }
      is_my_task: { Args: { p_node: number }; Returns: boolean }
      is_room_leader: { Args: { p_room: number }; Returns: boolean }
      is_room_member: { Args: { p_room: number }; Returns: boolean }
      is_task_assignee: {
        Args: { p_node: number; p_user: string }
        Returns: boolean
      }
      iso: { Args: { p_ts: string }; Returns: string }
      kst_deadline: { Args: { p_end: string }; Returns: string }
      kst_today: { Args: never; Returns: string }
      leaf_state: {
        Args: {
          p_asg: number
          p_e: string
          p_s: string
          p_sub: number
          p_today: string
        }
        Returns: string
      }
      me_get: { Args: never; Returns: Json }
      me_update: {
        Args: { p_nickname?: string; p_optional_mail_enabled?: boolean }
        Returns: Json
      }
      meta_get: { Args: never; Returns: Json }
      nickname_check: { Args: { p_value: string }; Returns: Json }
      nickname_normalize: { Args: { p_value: string }; Returns: string }
      nickname_problem: { Args: { p_value: string }; Returns: string }
      pct: { Args: { p_asg: number; p_sub: number }; Returns: number }
      person_json: { Args: { p_user: string }; Returns: Json }
      require_user: { Args: never; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      slugify: { Args: { p_id: number; p_title: string }; Returns: string }
      task_code: {
        Args: {
          p_e: string
          p_first: string
          p_late: boolean
          p_s: string
          p_today: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

