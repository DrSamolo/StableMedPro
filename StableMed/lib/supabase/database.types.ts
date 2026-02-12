// Generated from the current Supabase schema snapshot (chat step 3.2 included).
// Keep this file in sync with migrations when schema changes.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      conversations: {
        Row: {
          id: string;
          type: "dm" | "group";
          name: string | null;
          description: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          type: "dm" | "group";
          name?: string | null;
          description?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          type?: "dm" | "group";
          name?: string | null;
          description?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      conversation_participants: {
        Row: {
          conversation_id: string;
          user_id: string;
          last_read_at: string | null;
          joined_at: string;
        };
        Insert: {
          conversation_id: string;
          user_id: string;
          last_read_at?: string | null;
          joined_at?: string;
        };
        Update: {
          conversation_id?: string;
          user_id?: string;
          last_read_at?: string | null;
          joined_at?: string;
        };
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_id?: string;
          content?: string;
          created_at?: string;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: "task_reminder" | "lead_update" | "system" | "mention" | "message";
          title: string;
          message: string;
          metadata: Json;
          is_read: boolean;
          created_at: string;
          reference_id: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: "task_reminder" | "lead_update" | "system" | "mention" | "message";
          title: string;
          message: string;
          metadata?: Json;
          is_read?: boolean;
          created_at?: string;
          reference_id?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: "task_reminder" | "lead_update" | "system" | "mention" | "message";
          title?: string;
          message?: string;
          metadata?: Json;
          is_read?: boolean;
          created_at?: string;
          reference_id?: string | null;
        };
      };
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          avatar_url: string | null;
          role: string;
          manager_id: string | null;
          team_id: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          role?: string;
          manager_id?: string | null;
          team_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          role?: string;
          manager_id?: string | null;
          team_id?: string | null;
          created_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      conversation_type: "dm" | "group";
      notification_type: "task_reminder" | "lead_update" | "system" | "mention" | "message";
    };
    CompositeTypes: Record<string, never>;
  };
};

