export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      events: {
        Row: {
          away_score: number | null;
          away_team: string;
          commence_time: string;
          home_score: number | null;
          home_team: string;
          id: string;
          scores_synced_at: string | null;
          sport_key: string;
          sport_title: string | null;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          away_score?: number | null;
          away_team: string;
          commence_time: string;
          home_score?: number | null;
          home_team: string;
          id: string;
          scores_synced_at?: string | null;
          sport_key: string;
          sport_title?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          away_score?: number | null;
          away_team?: string;
          commence_time?: string;
          home_score?: number | null;
          home_team?: string;
          id?: string;
          scores_synced_at?: string | null;
          sport_key?: string;
          sport_title?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string;
          id: string;
          is_guest: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name: string;
          id: string;
          is_guest?: boolean;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          is_guest?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      tournament_events: {
        Row: {
          event_id: string;
          tournament_id: string;
        };
        ComputedFields: never;
        Insert: {
          event_id: string;
          tournament_id: string;
        };
        Update: {
          event_id?: string;
          tournament_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tournament_events_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tournament_events_tournament_id_fkey";
            columns: ["tournament_id"];
            isOneToOne: false;
            referencedRelation: "tournaments";
            referencedColumns: ["id"];
          },
        ];
      };
      tournament_participants: {
        Row: {
          expected_value_cents: number | null;
          id: string;
          joined_at: string;
          rank: number | null;
          remaining_bankroll_cents: number;
          total_potential_payout_cents: number;
          tournament_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          expected_value_cents?: number | null;
          id?: string;
          joined_at?: string;
          rank?: number | null;
          remaining_bankroll_cents: number;
          total_potential_payout_cents?: number;
          tournament_id: string;
          user_id: string;
        };
        Update: {
          expected_value_cents?: number | null;
          id?: string;
          joined_at?: string;
          rank?: number | null;
          remaining_bankroll_cents?: number;
          total_potential_payout_cents?: number;
          tournament_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tournament_participants_tournament_id_fkey";
            columns: ["tournament_id"];
            isOneToOne: false;
            referencedRelation: "tournaments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tournament_participants_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tournaments: {
        Row: {
          allowed_bet_types: NonNullable<Json>;
          code: string;
          created_at: string;
          description: string | null;
          host_id: string;
          id: string;
          lock_time: string;
          max_bet_cents: number | null;
          min_total_wager_cents: number;
          sport_key: string;
          starting_bankroll_cents: number;
          status: Database["public"]["Enums"]["tournament_status"];
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          allowed_bet_types?: NonNullable<Json>;
          code: string;
          created_at?: string;
          description?: string | null;
          host_id: string;
          id?: string;
          lock_time: string;
          max_bet_cents?: number | null;
          min_total_wager_cents?: number;
          sport_key: string;
          starting_bankroll_cents?: number;
          status?: Database["public"]["Enums"]["tournament_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          allowed_bet_types?: NonNullable<Json>;
          code?: string;
          created_at?: string;
          description?: string | null;
          host_id?: string;
          id?: string;
          lock_time?: string;
          max_bet_cents?: number | null;
          min_total_wager_cents?: number;
          sport_key?: string;
          starting_bankroll_cents?: number;
          status?: Database["public"]["Enums"]["tournament_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tournaments_host_id_fkey";
            columns: ["host_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_tournament: {
        Args: {
          p_allowed_bet_types?: Json;
          p_code_prefix?: string;
          p_description?: string;
          p_event_ids: string[];
          p_lock_time?: string;
          p_max_bet_cents?: number;
          p_starting_bankroll_cents?: number;
          p_title: string;
        };
        Returns: {
          code: string;
          id: string;
        }[];
      };
      get_roster: {
        Args: { p_tournament_id: string };
        Returns: {
          avatar_url: string;
          display_name: string;
          is_host: boolean;
          joined_at: string;
          user_id: string;
        }[];
      };
      get_tournament_preview: {
        Args: { p_code: string };
        Returns: {
          code: string;
          description: string;
          events: Json;
          host_name: string;
          id: string;
          lock_time: string;
          participant_count: number;
          sport_key: string;
          starting_bankroll_cents: number;
          status: Database["public"]["Enums"]["tournament_status"];
          title: string;
        }[];
      };
      join_tournament: { Args: { p_code: string }; Returns: string };
    };
    Enums: {
      tournament_status: "draft" | "open" | "locked" | "live" | "settled";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      tournament_status: ["draft", "open", "locked", "live", "settled"],
    },
  },
} as const;
