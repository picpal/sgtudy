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
      api_audit: {
        Row: {
          created_at: string
          dry_run: boolean | null
          error_code: string | null
          id: number
          ok: boolean
          op: string
          preview_id: string | null
          room_id: number | null
          source: string
          summary: Json
          token_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          dry_run?: boolean | null
          error_code?: string | null
          id?: never
          ok: boolean
          op: string
          preview_id?: string | null
          room_id?: number | null
          source: string
          summary?: Json
          token_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          dry_run?: boolean | null
          error_code?: string | null
          id?: never
          ok?: boolean
          op?: string
          preview_id?: string | null
          room_id?: number | null
          source?: string
          summary?: Json
          token_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_audit_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_audit_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "api_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_audit_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_audit_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      api_plan_drafts: {
        Row: {
          applied_at: string | null
          apply_response: Json | null
          created_at: string
          expires_at: string
          id: string
          path_map: Json
          plan: Json
          preview: Json
          resolved: Json
          room_id: number
          sched_changes: Json | null
          undo_of: string | null
          user_id: string
          version: string
        }
        Insert: {
          applied_at?: string | null
          apply_response?: Json | null
          created_at: string
          expires_at: string
          id: string
          path_map?: Json
          plan: Json
          preview: Json
          resolved: Json
          room_id: number
          sched_changes?: Json | null
          undo_of?: string | null
          user_id: string
          version: string
        }
        Update: {
          applied_at?: string | null
          apply_response?: Json | null
          created_at?: string
          expires_at?: string
          id?: string
          path_map?: Json
          plan?: Json
          preview?: Json
          resolved?: Json
          room_id?: number
          sched_changes?: Json | null
          undo_of?: string | null
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_plan_drafts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_plan_drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_plan_drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      api_tokens: {
        Row: {
          created_at: string
          expires_at: string
          http_count: number
          http_window: string | null
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          http_count?: number
          http_window?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes: string[]
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          http_count?: number
          http_window?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash?: string
          token_prefix?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_answers: {
        Row: {
          answer: Json
          attempt_id: number
          earned: number | null
          is_correct: boolean | null
          question_id: number
          saved_at: string
        }
        Insert: {
          answer: Json
          attempt_id: number
          earned?: number | null
          is_correct?: boolean | null
          question_id: number
          saved_at?: string
        }
        Update: {
          answer?: Json
          attempt_id?: number
          earned?: number | null
          is_correct?: boolean | null
          question_id?: number
          saved_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_attempts: {
        Row: {
          correct_count: number | null
          id: number
          max_score: number | null
          node_id: number
          score: number | null
          started_at: string
          status: string
          submitted_at: string | null
          user_id: string
        }
        Insert: {
          correct_count?: number | null
          id?: never
          max_score?: number | null
          node_id: number
          score?: number | null
          started_at?: string
          status?: string
          submitted_at?: string | null
          user_id: string
        }
        Update: {
          correct_count?: number | null
          id?: never
          max_score?: number | null
          node_id?: number
          score?: number | null
          started_at?: string
          status?: string
          submitted_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_attempts_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["node_id"]
          },
          {
            foreignKeyName: "exam_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_questions: {
        Row: {
          answer: Json
          choices: Json | null
          explanation_md: string
          id: number
          node_id: number
          ord: number
          points: number
          prompt_md: string
          qtype: string
        }
        Insert: {
          answer: Json
          choices?: Json | null
          explanation_md?: string
          id?: never
          node_id: number
          ord: number
          points?: number
          prompt_md: string
          qtype: string
        }
        Update: {
          answer?: Json
          choices?: Json | null
          explanation_md?: string
          id?: never
          node_id?: number
          ord?: number
          points?: number
          prompt_md?: string
          qtype?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_questions_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["node_id"]
          },
        ]
      }
      exams: {
        Row: {
          brief: Json | null
          created_by: string | null
          node_id: number
          published_at: string | null
          question_count: number
          reveal: string
          room_id: number
          source: string
          status: string
          total_points: number
          updated_at: string
        }
        Insert: {
          brief?: Json | null
          created_by?: string | null
          node_id: number
          published_at?: string | null
          question_count?: number
          reveal?: string
          room_id: number
          source?: string
          status?: string
          total_points?: number
          updated_at?: string
        }
        Update: {
          brief?: Json | null
          created_by?: string | null
          node_id?: number
          published_at?: string | null
          question_count?: number
          reveal?: string
          room_id?: number
          source?: string
          status?: string
          total_points?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: true
            referencedRelation: "goal_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          attached_at: string | null
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
          attached_at?: string | null
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
          attached_at?: string | null
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
          created_by: string | null
          depth: number
          description_md: string
          end_date: string
          id: number
          label: string | null
          owner_id: string | null
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
          created_by?: string | null
          depth: number
          description_md?: string
          end_date: string
          id?: never
          label?: string | null
          owner_id?: string | null
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
          created_by?: string | null
          depth?: number
          description_md?: string
          end_date?: string
          id?: never
          label?: string | null
          owner_id?: string | null
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
            foreignKeyName: "goal_nodes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_nodes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_nodes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_nodes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
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
      invite_code_failures: {
        Row: {
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_code_failures_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_code_failures_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
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
      member_requests: {
        Row: {
          apply_message: string | null
          leave_request_reason: string | null
          leave_requested_at: string | null
          room_id: number
          updated_at: string
          user_id: string
        }
        Insert: {
          apply_message?: string | null
          leave_request_reason?: string | null
          leave_requested_at?: string | null
          room_id: number
          updated_at?: string
          user_id: string
        }
        Update: {
          apply_message?: string | null
          leave_request_reason?: string | null
          leave_requested_at?: string | null
          room_id?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_requests_room_id_user_id_fkey"
            columns: ["room_id", "user_id"]
            isOneToOne: true
            referencedRelation: "room_members"
            referencedColumns: ["room_id", "user_id"]
          },
        ]
      }
      node_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: number
          mention_ids: string[]
          node_id: number
          room_id: number
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: never
          mention_ids?: string[]
          node_id: number
          room_id: number
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: never
          mention_ids?: string[]
          node_id?: number
          room_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_comments_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_comments_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_comments_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "goal_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_comments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
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
          bypass_max: number | null
          bypass_until: string | null
          bypass_used: number
          code: string | null
          created_at: string
          created_by: string
          revoked_at: string | null
          room_id: number
          token: string
        }
        Insert: {
          bypass_max?: number | null
          bypass_until?: string | null
          bypass_used?: number
          code?: string | null
          created_at?: string
          created_by: string
          revoked_at?: string | null
          room_id: number
          token: string
        }
        Update: {
          bypass_max?: number | null
          bypass_until?: string | null
          bypass_used?: number
          code?: string | null
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
          apply_message: string | null
          assign_from: string | null
          can_edit_curriculum: boolean
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: number
          joined_at: string | null
          leave_request_reason: string | null
          leave_requested_at: string | null
          left_at: string | null
          role: string
          room_id: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          apply_message?: string | null
          assign_from?: string | null
          can_edit_curriculum?: boolean
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: never
          joined_at?: string | null
          leave_request_reason?: string | null
          leave_requested_at?: string | null
          left_at?: string | null
          role: string
          room_id: number
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          applied_at?: string | null
          apply_message?: string | null
          assign_from?: string | null
          can_edit_curriculum?: boolean
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: never
          joined_at?: string | null
          leave_request_reason?: string | null
          leave_requested_at?: string | null
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
      room_notice_reads: {
        Row: {
          notice_id: number
          read_at: string
          read_rev: number
          user_id: string
        }
        Insert: {
          notice_id: number
          read_at?: string
          read_rev: number
          user_id: string
        }
        Update: {
          notice_id?: number
          read_at?: string
          read_rev?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_notice_reads_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "room_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_notice_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_notice_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      room_notices: {
        Row: {
          author_id: string | null
          body_md: string
          created_at: string
          id: number
          pinned: boolean
          popup: boolean
          popup_rev: number
          room_id: number
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body_md: string
          created_at?: string
          id?: never
          pinned?: boolean
          popup?: boolean
          popup_rev?: number
          room_id: number
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body_md?: string
          created_at?: string
          id?: never
          pinned?: boolean
          popup?: boolean
          popup_rev?: number
          room_id?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_notices_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_notices_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_notices_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
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
          submission_digest: boolean
          task_assigned: boolean
        }
        Insert: {
          completion_mode?: string
          reminder_d1?: boolean
          reminder_d3?: boolean
          room_id: number
          room_start_end?: boolean
          schedule_changed?: boolean
          submission_digest?: boolean
          task_assigned?: boolean
        }
        Update: {
          completion_mode?: string
          reminder_d1?: boolean
          reminder_d3?: boolean
          room_id?: number
          room_start_end?: boolean
          schedule_changed?: boolean
          submission_digest?: boolean
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
          recruit_until: string | null
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
          recruit_until?: string | null
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
          recruit_until?: string | null
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
      allowed_mime_types: { Args: never; Returns: string[] }
      api_authenticate: {
        Args: { p_op: string; p_token: string }
        Returns: {
          created_at: string
          expires_at: string
          http_count: number
          http_window: string | null
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          token_hash: string
          token_prefix: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "api_tokens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      api_curriculum_view: { Args: { p_c: Json; p_uid: string }; Returns: Json }
      api_error_json: {
        Args: {
          p_code: string
          p_detail: string
          p_hint: string
          p_state: string
        }
        Returns: Json
      }
      api_invoke: {
        Args: { p_args?: Json; p_op: string; p_token: string }
        Returns: Json
      }
      api_limits: { Args: never; Returns: Json }
      api_node_file_counts: { Args: { p_room: number }; Returns: Json }
      api_rate_check: {
        Args: {
          p_dry: boolean
          p_op: string
          p_replay?: boolean
          p_token: string
          p_user: string
        }
        Returns: undefined
      }
      api_resolve_study: {
        Args: { p_text: string; p_uid: string }
        Returns: string
      }
      api_scope_of: { Args: { p_op: string }; Returns: string }
      api_studies: {
        Args: { p_include_ended: boolean; p_uid: string }
        Returns: Json
      }
      api_token_json: {
        Args: { t: Database["public"]["Tables"]["api_tokens"]["Row"] }
        Returns: Json
      }
      api_user_lock: { Args: { p_user: string }; Returns: undefined }
      app_now: { Args: never; Returns: string }
      assignment_resync: { Args: { p_room: number }; Returns: undefined }
      can_edit_curriculum: {
        Args: { p_uid: string; r: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: boolean
      }
      can_read_room: { Args: { p_room: number }; Returns: boolean }
      can_read_submission: {
        Args: { p_author: string; p_node: number }
        Returns: boolean
      }
      can_read_submissions: { Args: { p_room: number }; Returns: boolean }
      comment_assert_writable: {
        Args: {
          n: Database["public"]["Tables"]["goal_nodes"]["Row"]
          p_uid: string
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: undefined
      }
      comment_create: {
        Args: { p_body: string; p_node: number; p_slug: string }
        Returns: Json
      }
      comment_delete: {
        Args: { p_id: number; p_slug: string }
        Returns: undefined
      }
      comment_exam_locked: {
        Args: {
          n: Database["public"]["Tables"]["goal_nodes"]["Row"]
          p_uid: string
        }
        Returns: boolean
      }
      comment_excerpt: {
        Args: { p_body: string; p_room: number }
        Returns: string
      }
      comment_items: {
        Args: {
          p_can_write: boolean
          p_leader: boolean
          p_rows: Database["public"]["Tables"]["node_comments"]["Row"][]
          p_viewer: string
        }
        Returns: Record<string, unknown>
      }
      comment_json: {
        Args: {
          c: Database["public"]["Tables"]["node_comments"]["Row"]
          p_can_write: boolean
          p_leader: boolean
          p_viewer: string
        }
        Returns: Json
      }
      comment_limits: { Args: never; Returns: Json }
      comment_list: {
        Args: {
          p_before?: number
          p_from?: number
          p_node: number
          p_slug: string
        }
        Returns: Json
      }
      comment_notify: {
        Args: {
          c: Database["public"]["Tables"]["node_comments"]["Row"]
          p_actor: string
          p_new: string[]
        }
        Returns: number
      }
      comment_parse: {
        Args: { p_body: string }
        Returns: Record<string, unknown>
      }
      comment_people: {
        Args: { p_ids: string[]; p_room: number }
        Returns: Json
      }
      comment_rate_check: { Args: { p_uid: string }; Returns: undefined }
      comment_reader: {
        Args: { p_node: number; p_slug: string }
        Returns: Record<string, unknown>
      }
      comment_reader_room: {
        Args: { p_slug: string }
        Returns: {
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
          recruit_until: string | null
          rules_md: string
          slug: string
          start_date: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      comment_row: {
        Args: { p_id: number; r: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: Record<string, unknown>
      }
      comment_target_ok: {
        Args: { n: Database["public"]["Tables"]["goal_nodes"]["Row"] }
        Returns: boolean
      }
      comment_token_re: { Args: never; Returns: string }
      comment_update: {
        Args: { p_body: string; p_id: number; p_slug: string }
        Returns: Json
      }
      comment_validate: {
        Args: { p_body: string }
        Returns: Record<string, unknown>
      }
      comment_writable: {
        Args: {
          n: Database["public"]["Tables"]["goal_nodes"]["Row"]
          p_uid: string
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: string
      }
      current_user_id: { Args: never; Returns: string }
      curriculum_get: {
        Args: { p_include_archived?: boolean; p_slug: string }
        Returns: Json
      }
      curriculum_json: {
        Args: { p_include_archived: boolean; p_room: number; p_uid: string }
        Returns: Json
      }
      curriculum_plan_apply: {
        Args: { p_preview_id: string; p_slug: string }
        Returns: Json
      }
      curriculum_plan_preview: {
        Args: { p_plan: Json; p_slug: string; p_undo_of?: string }
        Returns: Json
      }
      curriculum_version: { Args: { p_room: number }; Returns: string }
      deactivate_check: {
        Args: { p_lock: boolean; p_slug: string; p_user: string }
        Returns: {
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
          recruit_until: string | null
          rules_md: string
          slug: string
          start_date: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      deactivate_pending: {
        Args: { p_room: number; p_user: string }
        Returns: {
          node_id: number
          others: string[]
          round_label: string
          title: string
        }[]
      }
      exam_answer_canon: {
        Args: {
          p_answer: Json
          q: Database["public"]["Tables"]["exam_questions"]["Row"]
        }
        Returns: Json
      }
      exam_answer_save: {
        Args: { p_answer: Json; p_node: number; p_question: number }
        Returns: Json
      }
      exam_answer_shape_ok: {
        Args: {
          p_answer: Json
          q: Database["public"]["Tables"]["exam_questions"]["Row"]
        }
        Returns: boolean
      }
      exam_assert_creatable: { Args: { p_node: number }; Returns: undefined }
      exam_assert_unlocked: {
        Args: { p_node: number; p_what: string }
        Returns: undefined
      }
      exam_attempt_get: {
        Args: { p_node: number; p_slug: string; p_user: string }
        Returns: Json
      }
      exam_brief_put: {
        Args: { p_brief: Json; p_node: number; p_slug: string }
        Returns: Json
      }
      exam_brief_text: {
        Args: { p_node: number; p_slug: string }
        Returns: Json
      }
      exam_closed: {
        Args: {
          n: Database["public"]["Tables"]["goal_nodes"]["Row"]
          x: Database["public"]["Tables"]["exams"]["Row"]
        }
        Returns: boolean
      }
      exam_contract_text: { Args: never; Returns: string }
      exam_draft_put: {
        Args: { p_exam: Json; p_node: number; p_slug: string }
        Returns: Json
      }
      exam_editable_leaf: {
        Args: { p_node: number; p_slug: string }
        Returns: Record<string, unknown>
      }
      exam_get: { Args: { p_node: number; p_slug: string }; Returns: Json }
      exam_grade: {
        Args: {
          p_answer: Json
          q: Database["public"]["Tables"]["exam_questions"]["Row"]
        }
        Returns: Record<string, unknown>
      }
      exam_is_answered: { Args: { p_answer: Json }; Returns: boolean }
      exam_norm: { Args: { p: string }; Returns: string }
      exam_publish: { Args: { p_node: number; p_slug: string }; Returns: Json }
      exam_put: {
        Args: { p_exam: Json; p_node: number; p_slug: string }
        Returns: Json
      }
      exam_questions_jsonb: { Args: { p_node: number }; Returns: Json }
      exam_replace_questions: {
        Args: { p_node: number; p_qs: Json; p_source: string }
        Returns: undefined
      }
      exam_results: { Args: { p_node: number; p_slug: string }; Returns: Json }
      exam_reveal_ok: {
        Args: {
          a: Database["public"]["Tables"]["exam_attempts"]["Row"]
          n: Database["public"]["Tables"]["goal_nodes"]["Row"]
          x: Database["public"]["Tables"]["exams"]["Row"]
        }
        Returns: boolean
      }
      exam_struct_key: { Args: { p_qs: Json }; Returns: string }
      exam_submit: { Args: { p_node: number }; Returns: Json }
      exam_submitted_count: { Args: { p_node: number }; Returns: number }
      exam_summary: { Args: { p_node: number; p_uid: string }; Returns: Json }
      exam_target: {
        Args: { p_node: number; p_uid: string }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          depth: number
          description_md: string
          end_date: string
          id: number
          label: string | null
          owner_id: string | null
          parent_id: number | null
          room_id: number
          round_id: number | null
          sort_order: number
          start_date: string
          task_type: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "goal_nodes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      exam_unpublish: {
        Args: { p_node: number; p_slug: string }
        Returns: Json
      }
      exam_validate: { Args: { p_exam: Json }; Returns: Json }
      exam_view: {
        Args: { p_for: string; p_node: number; p_uid: string }
        Returns: Json
      }
      exam_viewer_member: {
        Args: { p_uid: string; r: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: boolean
      }
      fail: {
        Args: { p_code: string; p_detail: string; p_hint?: Json }
        Returns: undefined
      }
      file_discard: { Args: { p_file: string }; Returns: Json }
      file_json: {
        Args: { p_file: Database["public"]["Tables"]["files"]["Row"] }
        Returns: Json
      }
      file_orphan_candidates: {
        Args: { p_limit: number }
        Returns: {
          bucket_id: string
          object_path: string
        }[]
      }
      file_orphan_grace: { Args: never; Returns: string }
      file_purge_candidates: {
        Args: { p_limit: number }
        Returns: {
          bucket_id: string
          id: string
          object_path: string
        }[]
      }
      file_purge_grace: { Args: never; Returns: string }
      file_register: {
        Args: {
          p_mime: string
          p_name: string
          p_node: number
          p_path: string
          p_size: number
        }
        Returns: Json
      }
      invite_bypass_ok: {
        Args: {
          i: Database["public"]["Tables"]["room_invites"]["Row"]
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: boolean
      }
      invite_bypass_set: {
        Args: { p_max?: number; p_slug: string; p_until: string }
        Returns: Json
      }
      invite_check: {
        Args: { p_room: number; p_token: string }
        Returns: boolean
      }
      invite_code_lookup: { Args: { p_code: string }; Returns: Json }
      invite_code_new: { Args: never; Returns: string }
      invite_code_norm: { Args: { p: string }; Returns: string }
      invite_ensure: { Args: { p_by: string; p_room: number }; Returns: string }
      invite_get: { Args: { p_slug: string }; Returns: Json }
      invite_join: {
        Args: { p_message?: string; p_token: string }
        Returns: Json
      }
      invite_json: {
        Args: {
          i: Database["public"]["Tables"]["room_invites"]["Row"]
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: Json
      }
      invite_preview: { Args: { p_token: string }; Returns: Json }
      invite_resolve: {
        Args: { p_token: string }
        Returns: {
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
          recruit_until: string | null
          rules_md: string
          slug: string
          start_date: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      invite_rotate: { Args: { p_slug: string }; Returns: Json }
      is_my_task: { Args: { p_node: number }; Returns: boolean }
      is_room_leader: { Args: { p_room: number }; Returns: boolean }
      is_room_member: { Args: { p_room: number }; Returns: boolean }
      is_task_assignee: {
        Args: { p_node: number; p_user: string }
        Returns: boolean
      }
      iso: { Args: { p_ts: string }; Returns: string }
      job_cleanup: { Args: never; Returns: Json }
      job_cleanup_files: { Args: never; Returns: number }
      job_completion_digest: { Args: never; Returns: number }
      job_deadline_reminder: { Args: never; Returns: number }
      job_draft_blocked: { Args: never; Returns: number }
      job_round_started: { Args: never; Returns: number }
      job_submission_digest: { Args: never; Returns: number }
      kst_deadline: { Args: { p_end: string }; Returns: string }
      kst_today: { Args: never; Returns: string }
      leader_room: {
        Args: { p_lock?: boolean; p_slug: string }
        Returns: {
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
          recruit_until: string | null
          rules_md: string
          slug: string
          start_date: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
      leave_requests_json: {
        Args: { r: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: Json
      }
      like_escape: { Args: { p_text: string }; Returns: string }
      me_get: { Args: never; Returns: Json }
      me_schedule: { Args: { p_from: string; p_to: string }; Returns: Json }
      me_schedule_leaves: {
        Args: { p_today: string; p_uid: string }
        Returns: {
          e: string
          node_id: number
          personal: boolean
          room_id: number
          round: string
          s: string
          slug: string
          st: string
          title: string
        }[]
      }
      me_studies: { Args: { p_include_archived?: boolean }; Returns: Json }
      me_tasks: { Args: never; Returns: Json }
      me_update: {
        Args: { p_nickname?: string; p_optional_mail_enabled?: boolean }
        Returns: Json
      }
      member_admin_json: {
        Args: {
          m: Database["public"]["Tables"]["room_members"]["Row"]
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: Json
      }
      member_can_edit_curriculum: {
        Args: {
          m: Database["public"]["Tables"]["room_members"]["Row"]
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: boolean
      }
      member_count_audit: { Args: never; Returns: number }
      member_deactivate: {
        Args: { p_decisions?: Json; p_slug: string; p_user: string }
        Returns: Json
      }
      member_deactivate_preview: {
        Args: { p_slug: string; p_user: string }
        Returns: Json
      }
      member_leave_request: {
        Args: { p_reason?: string; p_slug: string }
        Returns: Json
      }
      member_leave_request_cancel: { Args: { p_slug: string }; Returns: Json }
      member_leave_request_dismiss: {
        Args: { p_slug: string; p_user: string }
        Returns: Json
      }
      member_set_curriculum_editor: {
        Args: { p_allow: boolean; p_slug: string; p_user: string }
        Returns: Json
      }
      membership_result: {
        Args: { p_room: number; p_user: string }
        Returns: Json
      }
      meta_get: { Args: never; Returns: Json }
      nickname_check: { Args: { p_value: string }; Returns: Json }
      nickname_normalize: { Args: { p_value: string }; Returns: string }
      nickname_problem: { Args: { p_value: string }; Returns: string }
      node_archive: {
        Args: { p_node_id: number; p_slug: string }
        Returns: Json
      }
      node_assert_editable: {
        Args: { p_slug: string }
        Returns: {
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
          recruit_until: string | null
          rules_md: string
          slug: string
          start_date: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      node_create: {
        Args: {
          p_end_date?: string
          p_index?: number
          p_label?: string
          p_parent_id?: number
          p_slug: string
          p_start_date?: string
          p_task_type?: string
          p_title?: string
        }
        Returns: Json
      }
      node_create_core: {
        Args: {
          p_description_md: string
          p_end_date: string
          p_index: number
          p_label: string
          p_parent_id: number
          p_start_date: string
          p_task_type: string
          p_title: string
          p_uid: string
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: number
      }
      node_delete: {
        Args: { p_node_id: number; p_slug: string }
        Returns: Json
      }
      node_doc_key_ok: { Args: { p_name: string }; Returns: boolean }
      node_doc_object_readable: { Args: { p_name: string }; Returns: boolean }
      node_doc_object_writable: { Args: { p_name: string }; Returns: boolean }
      node_doc_readable: {
        Args: { p_node: number; p_uid: string }
        Returns: boolean
      }
      node_doc_readable_me: { Args: { p_node: number }; Returns: boolean }
      node_doc_target: {
        Args: { p_node: number; p_remove_only: boolean; p_uid: string }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          depth: number
          description_md: string
          end_date: string
          id: number
          label: string | null
          owner_id: string | null
          parent_id: number | null
          room_id: number
          round_id: number | null
          sort_order: number
          start_date: string
          task_type: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "goal_nodes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      node_doc_writable: {
        Args: { p_node: number; p_uid: string }
        Returns: boolean
      }
      node_file_discard: { Args: { p_file: string }; Returns: Json }
      node_file_limit: { Args: never; Returns: number }
      node_file_register: {
        Args: {
          p_mime: string
          p_name: string
          p_node: number
          p_path: string
          p_size: number
        }
        Returns: Json
      }
      node_files: { Args: { p_node: number }; Returns: Json }
      node_files_json: { Args: { p_node: number }; Returns: Json }
      node_files_set: {
        Args: { p_file_ids: string[]; p_node: number }
        Returns: Json
      }
      node_get: {
        Args: { p_node: number; p_room: number }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          depth: number
          description_md: string
          end_date: string
          id: number
          label: string | null
          owner_id: string | null
          parent_id: number | null
          room_id: number
          round_id: number | null
          sort_order: number
          start_date: string
          task_type: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "goal_nodes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      node_has_submissions: { Args: { p_node: number }; Returns: boolean }
      node_indent: {
        Args: { p_node_id: number; p_slug: string }
        Returns: Json
      }
      node_make_parent: {
        Args: {
          p: Database["public"]["Tables"]["goal_nodes"]["Row"]
          p_msg: string
        }
        Returns: undefined
      }
      node_move: {
        Args: {
          p_index: number
          p_node_id: number
          p_parent_id: number
          p_slug: string
        }
        Returns: Json
      }
      node_outdent: {
        Args: { p_node_id: number; p_slug: string }
        Returns: Json
      }
      node_renumber: {
        Args: { p_except?: number; p_parent: number; p_room: number }
        Returns: undefined
      }
      node_subtree: { Args: { p_node: number }; Returns: number[] }
      node_unarchive: {
        Args: { p_node_id: number; p_slug: string }
        Returns: Json
      }
      node_update: {
        Args: { p_node_id: number; p_patch: Json; p_slug: string }
        Returns: Json
      }
      notice_assert_editable: {
        Args: { r: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: undefined
      }
      notice_assert_limit: {
        Args: { p_except?: number; p_kind: string; p_room: number }
        Returns: undefined
      }
      notice_create: { Args: { p_input: Json; p_slug: string }; Returns: Json }
      notice_delete: {
        Args: { p_id: number; p_slug: string }
        Returns: undefined
      }
      notice_inbox: { Args: { p_slug: string }; Returns: Json }
      notice_json: {
        Args: {
          n: Database["public"]["Tables"]["room_notices"]["Row"]
          p_viewer: string
        }
        Returns: Json
      }
      notice_limits: { Args: never; Returns: Json }
      notice_list: { Args: { p_slug: string }; Returns: Json }
      notice_mark_read: {
        Args: { p_notice: number; p_user: string }
        Returns: undefined
      }
      notice_notify: {
        Args: {
          n: Database["public"]["Tables"]["room_notices"]["Row"]
          p_actor: string
        }
        Returns: number
      }
      notice_read: { Args: { p_ids: number[]; p_slug: string }; Returns: Json }
      notice_reader_room: {
        Args: { p_slug: string }
        Returns: {
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
          recruit_until: string | null
          rules_md: string
          slug: string
          start_date: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notice_unread: {
        Args: { p_room: number; p_viewer: string }
        Returns: boolean
      }
      notice_update: {
        Args: { p_id: number; p_patch: Json; p_slug: string }
        Returns: Json
      }
      notice_validate: {
        Args: { p_in: Json; p_keys: string[]; p_partial: boolean }
        Returns: undefined
      }
      notification_json: {
        Args: { p_n: Database["public"]["Tables"]["notifications"]["Row"] }
        Returns: Json
      }
      notification_kinds: { Args: never; Returns: string[] }
      notifications_list: {
        Args: { p_cursor?: string; p_limit?: number }
        Returns: Json
      }
      notifications_read: { Args: { p_id: number }; Returns: undefined }
      notifications_read_all: { Args: never; Returns: Json }
      notifications_unread_count: { Args: never; Returns: Json }
      notify_date: { Args: { p_d: string; p_today: string }; Returns: string }
      notify_enabled: {
        Args: { p_kind: string; p_model: Json; p_room: number }
        Returns: boolean
      }
      notify_link: {
        Args: { p_kind: string; p_node: number; p_room: number; p_user: string }
        Returns: string
      }
      notify_publish:
        | {
            Args: {
              p_actor: string
              p_dedupe_prefix: string
              p_kind: string
              p_model: Json
              p_node: number
              p_recipients: string[]
              p_room: number
            }
            Returns: number
          }
        | {
            Args: {
              p_actor: string
              p_dedupe_prefix: string
              p_kind: string
              p_link_hash: string
              p_model: Json
              p_node: number
              p_recipients: string[]
              p_room: number
            }
            Returns: number
          }
      notify_range: {
        Args: { p_e: string; p_s: string; p_today: string }
        Returns: string
      }
      notify_render: {
        Args: {
          p_actor: string
          p_kind: string
          p_model: Json
          p_node: number
          p_room: number
        }
        Returns: Json
      }
      pat_create: {
        Args: { p_days?: number; p_name: string; p_scopes: string[] }
        Returns: Json
      }
      pat_list: { Args: never; Returns: Json }
      pat_revoke: { Args: { p_id: string }; Returns: Json }
      patch_bool: { Args: { p_key: string; p_patch: Json }; Returns: boolean }
      patch_date: { Args: { p_key: string; p_patch: Json }; Returns: string }
      patch_int: { Args: { p_key: string; p_patch: Json }; Returns: number }
      pct: { Args: { p_asg: number; p_sub: number }; Returns: number }
      person_json: { Args: { p_user: string }; Returns: Json }
      personal_archive: {
        Args: { p_archived: boolean; p_node_id: number; p_slug: string }
        Returns: Json
      }
      personal_assert_capacity: {
        Args: { p_except: number; p_round: number; p_uid: string }
        Returns: undefined
      }
      personal_check: {
        Args: {
          p_e: string
          p_s: string
          p_title: string
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: undefined
      }
      personal_complete: {
        Args: { p_done: boolean; p_node_id: number; p_slug: string }
        Returns: Json
      }
      personal_create: {
        Args: {
          p_description_md?: string
          p_end_date?: string
          p_round_id: number
          p_slug: string
          p_start_date?: string
          p_title: string
        }
        Returns: Json
      }
      personal_create_many: {
        Args: { p_goals: Json; p_round: Json; p_slug: string }
        Returns: Json
      }
      personal_delete: {
        Args: { p_node_id: number; p_slug: string }
        Returns: Json
      }
      personal_delete_many: {
        Args: { p_ids: Json; p_slug: string }
        Returns: Json
      }
      personal_eligible: {
        Args: { p_room: number; p_uid: string }
        Returns: boolean
      }
      personal_get: {
        Args: { p_node: number; p_room: number; p_uid: string }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          depth: number
          description_md: string
          end_date: string
          id: number
          label: string | null
          owner_id: string | null
          parent_id: number | null
          room_id: number
          round_id: number | null
          sort_order: number
          start_date: string
          task_type: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "goal_nodes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      personal_limit: { Args: never; Returns: number }
      personal_room: {
        Args: { p_slug: string; p_uid: string }
        Returns: {
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
          recruit_until: string | null
          rules_md: string
          slug: string
          start_date: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      personal_round: {
        Args: { p_room: number; p_round: number }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          depth: number
          description_md: string
          end_date: string
          id: number
          label: string | null
          owner_id: string | null
          parent_id: number | null
          room_id: number
          round_id: number | null
          sort_order: number
          start_date: string
          task_type: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "goal_nodes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      personal_update: {
        Args: { p_node_id: number; p_patch: Json; p_slug: string }
        Returns: Json
      }
      personal_viewer: {
        Args: { p_room: number; p_uid: string }
        Returns: boolean
      }
      plan_assignees: { Args: { p_members: Json; p_val: Json }; Returns: Json }
      plan_changes: {
        Args: {
          a: Database["public"]["Tables"]["goal_nodes"]["Row"]
          b: Database["public"]["Tables"]["goal_nodes"]["Row"]
          p_set: Json
        }
        Returns: Json
      }
      plan_clip: { Args: { p: string }; Returns: string }
      plan_collapse_notifications: {
        Args: {
          p_actor: string
          p_after_id: number
          p_created: number[]
          p_room: number
        }
        Returns: Json
      }
      plan_date_try: { Args: { p: string }; Returns: string }
      plan_err: {
        Args: {
          p_code: string
          p_field?: string
          p_message: string
          p_path: string
        }
        Returns: Json
      }
      plan_flatten: {
        Args: { p_plan: Json }
        Returns: {
          has_children: boolean
          op: Json
          parent_path: string
          path: string
          seq: number
        }[]
      }
      plan_jsonb_union: { Args: { a: Json; b: Json }; Returns: Json }
      plan_kind: {
        Args: { n: Database["public"]["Tables"]["goal_nodes"]["Row"] }
        Returns: string
      }
      plan_map_paths: { Args: { p_items: Json; p_map: Json }; Returns: Json }
      plan_nicks: { Args: { p_node: number }; Returns: Json }
      plan_resolve: {
        Args: { p_plan: Json; r: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: Json
      }
      plan_resolve_node: {
        Args: {
          p_depth: number
          p_members: Json
          p_node: Json
          p_path: string
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: Json
      }
      plan_round_pick: {
        Args: { p_sel: Json; r: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: Json
      }
      plan_run: {
        Args: {
          p_dry: boolean
          p_plan: Json
          p_uid: string
          p_warn: Json
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: Json
      }
      plan_runtime_err: {
        Args: {
          p_code: string
          p_detail: string
          p_hint: string
          p_path: string
          p_state: string
        }
        Returns: Json
      }
      plan_shape_check: { Args: { p_plan: Json }; Returns: Json }
      plan_undo_check: { Args: { p_changes: Json }; Returns: Json }
      plan_undo_run: {
        Args: {
          p_changes: Json
          p_dry: boolean
          p_uid: string
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: Json
      }
      plan_validate: {
        Args: { p_plan: Json; r: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: Json
      }
      plan_warn_text: { Args: { p_code: string }; Returns: string }
      require_curriculum_editor: {
        Args: { p_uid: string; r: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: undefined
      }
      require_leader: {
        Args: {
          p_msg?: string
          p_uid: string
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: undefined
      }
      require_user: { Args: never; Returns: string }
      room_applications: { Args: { p_slug: string }; Returns: Json }
      room_apply: {
        Args: { p_invite_token?: string; p_message?: string; p_slug: string }
        Returns: Json
      }
      room_approve: { Args: { p_slug: string; p_user: string }; Returns: Json }
      room_archive: { Args: { p_slug: string }; Returns: Json }
      room_cancel_application: { Args: { p_slug: string }; Returns: Json }
      room_create: {
        Args: {
          p_cover_file_id?: string
          p_description_md?: string
          p_end_date: string
          p_intro: string
          p_is_public: boolean
          p_join_mode: string
          p_leader_does_tasks?: boolean
          p_max_members: number
          p_min_members?: number
          p_rules_md?: string
          p_start_date: string
          p_tag_slugs?: string[]
          p_title: string
        }
        Returns: Json
      }
      room_current_round_id: {
        Args: { p_room: number; p_today: string }
        Returns: number
      }
      room_decide_precheck: {
        Args: {
          p_uid: string
          p_user: string
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: {
          applied_at: string | null
          apply_message: string | null
          assign_from: string | null
          can_edit_curriculum: boolean
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: number
          joined_at: string | null
          leave_request_reason: string | null
          leave_requested_at: string | null
          left_at: string | null
          role: string
          room_id: number
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "room_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      room_delete: { Args: { p_slug: string }; Returns: undefined }
      room_detail_json: {
        Args: { p_room: number; p_uid: string }
        Returns: Json
      }
      room_extra_recruit_auto_expire: {
        Args: { p_room: number }
        Returns: boolean
      }
      room_extra_recruit_close: { Args: { p_slug: string }; Returns: Json }
      room_extra_recruit_expire: {
        Args: { p_actor: string; p_room: number }
        Returns: undefined
      }
      room_extra_recruit_open: {
        Args: {
          p_join_mode?: string
          p_max_members?: number
          p_slug: string
          p_until: string
        }
        Returns: Json
      }
      room_get: {
        Args: { p_invite_token?: string; p_slug: string }
        Returns: Json
      }
      room_hide_unless_known: {
        Args: {
          p_token?: string
          p_uid: string
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: undefined
      }
      room_in_scope: {
        Args: { p_room: number; p_scope: string; p_uid: string }
        Returns: boolean
      }
      room_join: {
        Args: { p_invite_token?: string; p_slug: string }
        Returns: Json
      }
      room_join_by_invite: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      room_join_precheck: {
        Args: {
          p_mode: string
          p_token: string
          p_uid: string
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: {
          applied_at: string | null
          apply_message: string | null
          assign_from: string | null
          can_edit_curriculum: boolean
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: number
          joined_at: string | null
          leave_request_reason: string | null
          leave_requested_at: string | null
          left_at: string | null
          role: string
          room_id: number
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "room_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      room_leaf_stats: {
        Args: { p_room: number }
        Returns: {
          asg: number
          end_date: string
          node_id: number
          parent_id: number
          round_id: number
          sort_order: number
          start_date: string
          sub: number
          task_type: string
          title: string
        }[]
      }
      room_leave: { Args: { p_slug: string }; Returns: Json }
      room_leave_requests: { Args: { p_slug: string }; Returns: Json }
      room_lock: {
        Args: { p_slug: string }
        Returns: {
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
          recruit_until: string | null
          rules_md: string
          slug: string
          start_date: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      room_matches: {
        Args: {
          p_q: string
          p_room: number
          p_status: string
          p_tags: string[]
        }
        Returns: boolean
      }
      room_me_json: { Args: { p_room: number; p_uid: string }; Returns: Json }
      room_member_activate: {
        Args: {
          p_uid: string
          p_via: string
          r: Database["public"]["Tables"]["rooms"]["Row"]
        }
        Returns: undefined
      }
      room_members_get: { Args: { p_slug: string }; Returns: Json }
      room_members_json: {
        Args: { p_room: number; p_uid: string }
        Returns: Json
      }
      room_open_recruit: { Args: { p_slug: string }; Returns: Json }
      room_period_check: {
        Args: { p_end: string; p_start: string }
        Returns: undefined
      }
      room_progress: {
        Args: { p_room: number }
        Returns: {
          asg: number
          node_id: number
          pct: number
          sub: number
        }[]
      }
      room_readable: {
        Args: { p_room: number; p_token?: string; p_uid: string }
        Returns: boolean
      }
      room_recruit_open: {
        Args: { r: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: boolean
      }
      room_recruit_until: {
        Args: { r: Database["public"]["Tables"]["rooms"]["Row"] }
        Returns: string
      }
      room_reject: { Args: { p_slug: string; p_user: string }; Returns: Json }
      room_release_seat: { Args: { p_room: number }; Returns: undefined }
      room_round_stats: {
        Args: { p_room: number }
        Returns: {
          asg: number
          end_date: string
          label: string
          leaf_count: number
          round_id: number
          sort_order: number
          start_date: string
          sub: number
          title: string
        }[]
      }
      room_start: { Args: { p_shift?: boolean; p_slug: string }; Returns: Json }
      room_start_date_repair: { Args: never; Returns: Json }
      room_tags_get: { Args: { p_slug: string }; Returns: Json }
      room_tags_json: { Args: { p_room: number }; Returns: Json }
      room_tags_put: {
        Args: { p_free_labels?: string[]; p_slug: string; p_slugs?: string[] }
        Returns: Json
      }
      room_tags_suggest: { Args: { p_slug: string }; Returns: Json }
      room_take_seat: { Args: { p_room: number }; Returns: undefined }
      room_tick: { Args: never; Returns: Json }
      room_transition_active: {
        Args: { p_actor: string; p_room: number }
        Returns: undefined
      }
      room_transition_ended: { Args: { p_room: number }; Returns: undefined }
      room_unarchive: { Args: { p_slug: string }; Returns: Json }
      room_update: { Args: { p_patch: Json; p_slug: string }; Returns: Json }
      rooms_list: {
        Args: {
          p_page?: number
          p_q?: string
          p_scope?: string
          p_size?: number
          p_sort?: string
          p_status?: string
          p_tags?: string[]
        }
        Returns: Json
      }
      settings_get: { Args: { p_slug: string }; Returns: Json }
      settings_json: { Args: { p_room: number }; Returns: Json }
      settings_put: {
        Args: { p_settings: Json; p_slug: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      slugify: { Args: { p_id: number; p_title: string }; Returns: string }
      storage_exists: {
        Args: { p_bucket: string; p_path: string }
        Returns: boolean
      }
      submission_json: { Args: { p_sub: number }; Returns: Json }
      submission_target: {
        Args: { p_node: number; p_uid: string }
        Returns: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          depth: number
          description_md: string
          end_date: string
          id: number
          label: string | null
          owner_id: string | null
          parent_id: number | null
          room_id: number
          round_id: number | null
          sort_order: number
          start_date: string
          task_type: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "goal_nodes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submission_upsert: {
        Args: {
          p_body: string
          p_file_ids: string[]
          p_links: string[]
          p_node: number
        }
        Returns: Json
      }
      tag_apply_auto: {
        Args: { p_room: number; p_slugs: string[] }
        Returns: Json
      }
      tag_autoselect: { Args: { p_room: number }; Returns: number }
      tag_slug_for: { Args: { p_label: string }; Returns: string }
      tag_term_hit: {
        Args: { p_term: string; p_text: string }
        Returns: boolean
      }
      tag_text_relevant: { Args: { p_text: string }; Returns: boolean }
      tags_search: { Args: { p_q?: string }; Returns: Json }
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
      task_get: { Args: { p_node: number; p_slug: string }; Returns: Json }
      task_node_json: { Args: { p_node: number; p_uid: string }; Returns: Json }
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

