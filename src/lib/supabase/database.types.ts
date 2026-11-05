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
      game_live: {
        Row: {
          away_score: number | null;
          detail: string | null;
          event_id: string;
          home_score: number | null;
          last_play: string | null;
          period: number | null;
          situation: string | null;
          state: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          away_score?: number | null;
          detail?: string | null;
          event_id: string;
          home_score?: number | null;
          last_play?: string | null;
          period?: number | null;
          situation?: string | null;
          state: string;
          updated_at?: string;
        };
        Update: {
          away_score?: number | null;
          detail?: string | null;
          event_id?: string;
          home_score?: number | null;
          last_play?: string | null;
          period?: number | null;
          situation?: string | null;
          state?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "game_live_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: true;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      odds_cache: {
        Row: {
          alt_point: number | null;
          bookmaker: string;
          event_id: string;
          id: number;
          is_live: boolean;
          locked_at: string | null;
          market_key: string;
          outcome_name: string;
          participant_name: string;
          point: number | null;
          price_american: number;
          price_decimal: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          alt_point?: never;
          bookmaker: string;
          event_id: string;
          id?: never;
          is_live?: boolean;
          locked_at?: string | null;
          market_key: string;
          outcome_name: string;
          participant_name?: string;
          point?: number | null;
          price_american: number;
          price_decimal?: never;
          updated_at?: string;
        };
        Update: {
          alt_point?: never;
          bookmaker?: string;
          event_id?: string;
          id?: never;
          is_live?: boolean;
          locked_at?: string | null;
          market_key?: string;
          outcome_name?: string;
          participant_name?: string;
          point?: number | null;
          price_american?: number;
          price_decimal?: never;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "odds_cache_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      odds_markets: {
        Row: {
          bookmaker: string;
          event_id: string;
          is_live: boolean;
          last_seen_at: string;
          market_key: string;
        };
        ComputedFields: never;
        Insert: {
          bookmaker: string;
          event_id: string;
          is_live?: boolean;
          last_seen_at: string;
          market_key: string;
        };
        Update: {
          bookmaker?: string;
          event_id?: string;
          is_live?: boolean;
          last_seen_at?: string;
          market_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: "odds_markets_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      player_stats: {
        Row: {
          event_id: string;
          initial_key: string | null;
          is_final: boolean;
          market_key: string;
          name_key: string;
          player_name: string;
          stat: number;
          team: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          event_id: string;
          initial_key?: never;
          is_final?: boolean;
          market_key: string;
          name_key: string;
          player_name: string;
          stat: number;
          team?: string | null;
          updated_at?: string;
        };
        Update: {
          event_id?: string;
          initial_key?: never;
          is_final?: boolean;
          market_key?: string;
          name_key?: string;
          player_name?: string;
          stat?: number;
          team?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "player_stats_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      player_teams: {
        Row: {
          initial_key: string | null;
          name_key: string;
          player_name: string;
          sport_key: string;
          team: string;
        };
        ComputedFields: never;
        Insert: {
          initial_key?: never;
          name_key: string;
          player_name: string;
          sport_key: string;
          team: string;
        };
        Update: {
          initial_key?: never;
          name_key?: string;
          player_name?: string;
          sport_key?: string;
          team?: string;
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
      prop_results: {
        Row: {
          event_id: string;
          graded_at: string;
          graded_by: string;
          market_key: string;
          participant_name: string;
          stat: number;
          tournament_id: string;
        };
        ComputedFields: never;
        Insert: {
          event_id: string;
          graded_at?: string;
          graded_by: string;
          market_key: string;
          participant_name: string;
          stat: number;
          tournament_id: string;
        };
        Update: {
          event_id?: string;
          graded_at?: string;
          graded_by?: string;
          market_key?: string;
          participant_name?: string;
          stat?: number;
          tournament_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prop_results_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prop_results_graded_by_fkey";
            columns: ["graded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prop_results_tournament_id_fkey";
            columns: ["tournament_id"];
            isOneToOne: false;
            referencedRelation: "tournaments";
            referencedColumns: ["id"];
          },
        ];
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
          is_locked: boolean | null;
          server_now: string | null;
        };
        ComputedFields: "is_locked" | "server_now";
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
      wager_legs: {
        Row: {
          event_id: string;
          id: string;
          line: number | null;
          market_key: string;
          odds_american: number;
          odds_decimal: number;
          odds_id: number | null;
          participant_id: string;
          participant_name: string;
          selection: string;
          settled_at: string | null;
          status: Database["public"]["Enums"]["leg_status"];
          tournament_id: string;
          wager_id: string;
          win_probability: number | null;
          live_probability: number | null;
          live_stat: number | null;
          participant_team: string | null;
        };
        ComputedFields: "live_probability" | "live_stat" | "participant_team";
        Insert: {
          event_id: string;
          id?: string;
          line?: number | null;
          market_key: string;
          odds_american: number;
          odds_decimal: number;
          odds_id?: number | null;
          participant_id: string;
          participant_name?: string;
          selection: string;
          settled_at?: string | null;
          status?: Database["public"]["Enums"]["leg_status"];
          tournament_id: string;
          wager_id: string;
          win_probability?: number | null;
        };
        Update: {
          event_id?: string;
          id?: string;
          line?: number | null;
          market_key?: string;
          odds_american?: number;
          odds_decimal?: number;
          odds_id?: number | null;
          participant_id?: string;
          participant_name?: string;
          selection?: string;
          settled_at?: string | null;
          status?: Database["public"]["Enums"]["leg_status"];
          tournament_id?: string;
          wager_id?: string;
          win_probability?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "wager_legs_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wager_legs_odds_id_fkey";
            columns: ["odds_id"];
            isOneToOne: false;
            referencedRelation: "odds_board";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wager_legs_odds_id_fkey";
            columns: ["odds_id"];
            isOneToOne: false;
            referencedRelation: "odds_cache";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wager_legs_participant_id_fkey";
            columns: ["participant_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard";
            referencedColumns: ["participant_id"];
          },
          {
            foreignKeyName: "wager_legs_participant_id_fkey";
            columns: ["participant_id"];
            isOneToOne: false;
            referencedRelation: "tournament_participants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wager_legs_tournament_id_fkey";
            columns: ["tournament_id"];
            isOneToOne: false;
            referencedRelation: "tournaments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wager_legs_wager_id_fkey";
            columns: ["wager_id"];
            isOneToOne: false;
            referencedRelation: "wagers";
            referencedColumns: ["id"];
          },
        ];
      };
      wagers: {
        Row: {
          amount_cents: number;
          created_at: string;
          id: string;
          is_locked: boolean;
          odds_american: number;
          odds_decimal: number;
          participant_id: string;
          payout_cents: number | null;
          potential_payout_cents: number;
          settled_at: string | null;
          status: Database["public"]["Enums"]["wager_status"];
          tournament_id: string;
          wager_type: Database["public"]["Enums"]["wager_type"];
          win_probability: number | null;
          current_payout: number | null;
          live_probability: number | null;
        };
        ComputedFields: "current_payout" | "live_probability";
        Insert: {
          amount_cents: number;
          created_at?: string;
          id?: string;
          is_locked?: boolean;
          odds_american: number;
          odds_decimal: number;
          participant_id: string;
          payout_cents?: number | null;
          potential_payout_cents: number;
          settled_at?: string | null;
          status?: Database["public"]["Enums"]["wager_status"];
          tournament_id: string;
          wager_type: Database["public"]["Enums"]["wager_type"];
          win_probability?: number | null;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          id?: string;
          is_locked?: boolean;
          odds_american?: number;
          odds_decimal?: number;
          participant_id?: string;
          payout_cents?: number | null;
          potential_payout_cents?: number;
          settled_at?: string | null;
          status?: Database["public"]["Enums"]["wager_status"];
          tournament_id?: string;
          wager_type?: Database["public"]["Enums"]["wager_type"];
          win_probability?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "wagers_participant_id_fkey";
            columns: ["participant_id"];
            isOneToOne: false;
            referencedRelation: "leaderboard";
            referencedColumns: ["participant_id"];
          },
          {
            foreignKeyName: "wagers_participant_id_fkey";
            columns: ["participant_id"];
            isOneToOne: false;
            referencedRelation: "tournament_participants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wagers_tournament_id_fkey";
            columns: ["tournament_id"];
            isOneToOne: false;
            referencedRelation: "tournaments";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      leaderboard: {
        Row: {
          bets_count: number | null;
          cash_cents: number;
          display_name: string;
          ev_cents: number | null;
          max_cents: number | null;
          participant_id: string;
          qualified: boolean | null;
          rank: number | null;
          standing: string | null;
          tournament_id: string;
          user_id: string;
          wagered_cents: number | null;
        };
        ComputedFields: never;
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
      odds_board: {
        Row: {
          event_id: string;
          id: number;
          is_stale: boolean | null;
          last_seen_at: string | null;
          market_key: string;
          outcome_name: string;
          participant_name: string;
          participant_team: string | null;
          point: number | null;
          price_american: number;
          price_decimal: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "odds_cache_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      beta_metrics: { Args: Record<PropertyKey, never>; Returns: Json };
      cancel_wager: { Args: { p_wager_id: string }; Returns: undefined };
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
      current_payout: {
        Args: {
          w: Omit<
            Database["public"]["Tables"]["wagers"]["Row"],
            Database["public"]["Tables"]["wagers"]["ComputedFields"]
          >;
        };
        Returns: number;
      };
      delete_tournament: { Args: { p_tournament_id: string }; Returns: undefined };
      get_roster: {
        Args: { p_tournament_id: string };
        Returns: {
          avatar_url: string;
          display_name: string;
          has_submitted: boolean;
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
          is_locked: boolean;
          lock_time: string;
          participant_count: number;
          sport_key: string;
          starting_bankroll_cents: number;
          status: Database["public"]["Enums"]["tournament_status"];
          title: string;
        }[];
      };
      grade_prop: {
        Args: {
          p_event_id: string;
          p_market_key: string;
          p_participant_name: string;
          p_stat: number;
          p_tournament_id: string;
        };
        Returns: Json;
      };
      is_locked: {
        Args: {
          t: Omit<
            Database["public"]["Tables"]["tournaments"]["Row"],
            Database["public"]["Tables"]["tournaments"]["ComputedFields"]
          >;
        };
        Returns: boolean;
      };
      join_tournament: { Args: { p_code: string }; Returns: string };
      leave_tournament: { Args: { p_tournament_id: string }; Returns: undefined };
      live_ingest: { Args: { p_games: Json; p_sport_key: string }; Returns: Json };
      live_probability:
        | {
            Args: {
              l: Omit<
                Database["public"]["Tables"]["wager_legs"]["Row"],
                Database["public"]["Tables"]["wager_legs"]["ComputedFields"]
              >;
            };
            Returns: number;
          }
        | {
            Args: {
              w: Omit<
                Database["public"]["Tables"]["wagers"]["Row"],
                Database["public"]["Tables"]["wagers"]["ComputedFields"]
              >;
            };
            Returns: number;
          };
      live_stat: {
        Args: {
          l: Omit<
            Database["public"]["Tables"]["wager_legs"]["Row"],
            Database["public"]["Tables"]["wager_legs"]["ComputedFields"]
          >;
        };
        Returns: number;
      };
      lock_tournament_now: { Args: { p_tournament_id: string }; Returns: undefined };
      odds_budget_reserve: {
        Args: { p_cost: number; p_endpoint: string; p_sport_key: string };
        Returns: Json;
      };
      odds_budget_settle: {
        Args: { p_credits_remaining?: number; p_credits_used?: number; p_reservation_id: number };
        Returns: undefined;
      };
      odds_budget_status: { Args: Record<PropertyKey, never>; Returns: Json };
      odds_set_paid_calls: { Args: { p_enabled: boolean }; Returns: Json };
      odds_sync_claim: { Args: { p_lease_seconds?: number }; Returns: Json };
      odds_sync_ingest: {
        Args: {
          p_events?: Json;
          p_fetched_at: string;
          p_kind: string;
          p_markets?: Json;
          p_outcomes?: Json;
          p_sport_key: string;
          p_usage?: Json;
        };
        Returns: Json;
      };
      odds_sync_release: { Args: { p_holder: string }; Returns: undefined };
      participant_team: {
        Args: {
          l: Omit<
            Database["public"]["Tables"]["wager_legs"]["Row"],
            Database["public"]["Tables"]["wager_legs"]["ComputedFields"]
          >;
        };
        Returns: string;
      };
      place_wagers: {
        Args: { p_slip: Json; p_tournament_id: string };
        Returns: {
          amount_cents: number;
          created_at: string;
          id: string;
          is_locked: boolean;
          odds_american: number;
          odds_decimal: number;
          participant_id: string;
          payout_cents: number | null;
          potential_payout_cents: number;
          settled_at: string | null;
          status: Database["public"]["Enums"]["wager_status"];
          tournament_id: string;
          wager_type: Database["public"]["Enums"]["wager_type"];
          win_probability: number | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "wagers";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      remove_participant: {
        Args: { p_tournament_id: string; p_user_id: string };
        Returns: undefined;
      };
      replace_wager: {
        Args: { p_slip: Json; p_wager_id: string };
        Returns: {
          amount_cents: number;
          created_at: string;
          id: string;
          is_locked: boolean;
          odds_american: number;
          odds_decimal: number;
          participant_id: string;
          payout_cents: number | null;
          potential_payout_cents: number;
          settled_at: string | null;
          status: Database["public"]["Enums"]["wager_status"];
          tournament_id: string;
          wager_type: Database["public"]["Enums"]["wager_type"];
          win_probability: number | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "wagers";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      rosters_due: { Args: { p_sport_key: string }; Returns: boolean };
      rosters_ingest: { Args: { p_players: Json; p_sport_key: string }; Returns: Json };
      scores_ingest: {
        Args: { p_fetched_at: string; p_scores: Json; p_sport_key: string };
        Returns: Json;
      };
      server_now: {
        Args: {
          t: Omit<
            Database["public"]["Tables"]["tournaments"]["Row"],
            Database["public"]["Tables"]["tournaments"]["ComputedFields"]
          >;
        };
        Returns: string;
      };
      stats_ingest: {
        Args: {
          p_event_id: string;
          p_final: boolean;
          p_provider_id: string;
          p_remaining?: number;
          p_stats: Json;
        };
        Returns: Json;
      };
      update_tournament: { Args: { p_changes: Json; p_tournament_id: string }; Returns: undefined };
    };
    Enums: {
      leg_status: "pending" | "hit" | "miss" | "push" | "void";
      tournament_status: "draft" | "open" | "locked" | "live" | "settled";
      wager_status: "pending" | "won" | "lost" | "pushed" | "void";
      wager_type: "single" | "parlay";
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
      leg_status: ["pending", "hit", "miss", "push", "void"],
      tournament_status: ["draft", "open", "locked", "live", "settled"],
      wager_status: ["pending", "won", "lost", "pushed", "void"],
      wager_type: ["single", "parlay"],
    },
  },
} as const;
