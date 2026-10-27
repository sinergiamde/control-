export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      analyses: {
        Row: {
          client_id: string | null
          cogs_total: number
          company: string
          created_at: string
          fees_total: number
          full_analysis: Json
          id: string
          opex_total: number
          original_filename: string
          period: string
          personal_total: number
          revenues_total: number
          top_category: string
          total_spent: number
          user_id: string
        }
        Insert: {
          client_id?: string | null
          cogs_total?: number
          company?: string
          created_at?: string
          fees_total?: number
          full_analysis?: Json
          id?: string
          opex_total?: number
          original_filename?: string
          period?: string
          personal_total?: number
          revenues_total?: number
          top_category?: string
          total_spent?: number
          user_id: string
        }
        Update: {
          client_id?: string | null
          cogs_total?: number
          company?: string
          created_at?: string
          fees_total?: number
          full_analysis?: Json
          id?: string
          opex_total?: number
          original_filename?: string
          period?: string
          personal_total?: number
          revenues_total?: number
          top_category?: string
          total_spent?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_summaries: {
        Row: {
          categories: Json
          client_id: string | null
          cogs_total: number
          fees_total: number
          generated_at: string
          id: string
          net_income: number
          opex_total: number
          personal_total: number
          revenues_total: number
          statements_count: number
          user_id: string
          year: number
        }
        Insert: {
          categories?: Json
          client_id?: string | null
          cogs_total?: number
          fees_total?: number
          generated_at?: string
          id?: string
          net_income?: number
          opex_total?: number
          personal_total?: number
          revenues_total?: number
          statements_count?: number
          user_id: string
          year: number
        }
        Update: {
          categories?: Json
          client_id?: string | null
          cogs_total?: number
          fees_total?: number
          generated_at?: string
          id?: string
          net_income?: number
          opex_total?: number
          personal_total?: number
          revenues_total?: number
          statements_count?: number
          user_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "annual_summaries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          analysis_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          file_name: string
          id: string
          period_label: string
          storage_path: string
          type: string
        }
        Insert: {
          analysis_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          file_name: string
          id?: string
          period_label?: string
          storage_path: string
          type: string
        }
        Update: {
          analysis_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          file_name?: string
          id?: string
          period_label?: string
          storage_path?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          client_id: string | null
          country: string | null
          created_at: string
          designated_by: string | null
          id: string
          name: string
          phone: string | null
          reviewed_at: string | null
          subscribed: boolean
          trial_ends_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          client_id?: string | null
          country?: string | null
          created_at?: string
          designated_by?: string | null
          id?: string
          name?: string
          phone?: string | null
          reviewed_at?: string | null
          subscribed?: boolean
          trial_ends_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          client_id?: string | null
          country?: string | null
          created_at?: string
          designated_by?: string | null
          id?: string
          name?: string
          phone?: string | null
          reviewed_at?: string | null
          subscribed?: boolean
          trial_ends_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_access: {
        Row: {
          client_id: string
          created_at: string
          granted_by: string | null
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          granted_by?: string | null
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          granted_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_access_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          data: Json
          id: string
          kind: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          kind: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          kind?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      receipts: {
        Row: {
          amount: number | null
          analysis_id: string | null
          client_id: string
          created_at: string
          currency: string
          extracted: Json | null
          file_name: string
          id: string
          merchant: string
          needs_review: string[]
          note: string
          receipt_date: string | null
          storage_path: string
          tax: number | null
          txn_amount: number | null
          txn_date: string | null
          txn_desc: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          analysis_id?: string | null
          client_id: string
          created_at?: string
          currency?: string
          extracted?: Json | null
          file_name?: string
          id?: string
          merchant?: string
          needs_review?: string[]
          note?: string
          receipt_date?: string | null
          storage_path: string
          tax?: number | null
          txn_amount?: number | null
          txn_date?: string | null
          txn_desc?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          analysis_id?: string | null
          client_id?: string
          created_at?: string
          currency?: string
          extracted?: Json | null
          file_name?: string
          id?: string
          merchant?: string
          needs_review?: string[]
          note?: string
          receipt_date?: string | null
          storage_path?: string
          tax?: number | null
          txn_amount?: number | null
          txn_date?: string | null
          txn_desc?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_delete_user: {
        Args: { _user_id: string }
        Returns: undefined
      }
      admin_create_user: {
        Args: { _email: string; _password: string; _name: string; _role: string; _client_ids: string[] }
        Returns: string
      }
      admin_set_user_role: {
        Args: { _user_id: string; _role: string }
        Returns: undefined
      }
      can_manage_user: {
        Args: { _user_id: string }
        Returns: boolean
      }
      admin_set_user_plan: {
        Args: { _user_id: string; _subscribed: boolean; _trial_ends_at?: string | null }
        Returns: undefined
      }
      can_manage_client: {
        Args: { _client_id: string }
        Returns: boolean
      }
      can_upload: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      create_client: {
        Args: { _name: string }
        Returns: string
      }
      request_subscription: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      role_of: {
        Args: { _user_id: string }
        Returns: string
      }
      set_user_clients: {
        Args: { _user_id: string; _client_ids: string[] }
        Returns: undefined
      }
      admin_delete_client: {
        Args: { _client_id: string }
        Returns: Json
      }
      admin_list_users: {
        Args: Record<PropertyKey, never>
        Returns: {
          user_id: string
          email: string
          last_sign_in_at: string | null
          created_at: string
        }[]
      }
      admin_set_user_password: {
        Args: { _user_id: string; _new_password: string }
        Returns: undefined
      }
      can_access_client: {
        Args: { _client_id: string }
        Returns: boolean
      }
      my_client_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user" | "accountant" | "authorized"
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
  public: {
    Enums: {
      app_role: ["admin", "user", "accountant", "authorized"],
    },
  },
} as const
