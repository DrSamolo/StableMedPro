import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MIGRATION_PATH = new URL(
  "../supabase/migrations/20260211_step3_2_chat_conversations_core.sql",
  import.meta.url,
);

const sql = readFileSync(MIGRATION_PATH, "utf8");

test("creates conversations, participants and messages tables", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.conversations[\s\S]*type public\.conversation_type NOT NULL/mi);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.conversation_participants[\s\S]*PRIMARY KEY \(conversation_id, user_id\)/mi);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.messages[\s\S]*content TEXT NOT NULL/mi);
});

test("enforces participant-based RLS on messages", () => {
  assert.match(sql, /ALTER TABLE public\.messages ENABLE ROW LEVEL SECURITY/mi);
  assert.match(sql, /ALTER TABLE public\.messages FORCE ROW LEVEL SECURITY/mi);
  assert.match(sql, /CREATE POLICY messages_select_if_participant ON public\.messages[\s\S]*is_conversation_participant/mi);
  assert.match(sql, /CREATE POLICY messages_insert_if_participant_sender ON public\.messages[\s\S]*sender_id = auth\.uid\(\)/mi);
});

test("adds mention and message notifications trigger", () => {
  assert.match(sql, /ALTER TYPE public\.notification_type ADD VALUE 'mention'/mi);
  assert.match(sql, /ALTER TYPE public\.notification_type ADD VALUE 'message'/mi);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.on_message_created_notify_mentions\(\)/mi);
  assert.match(sql, /regexp_matches\(NEW\.content, '@\(\[a-zA-Z0-9_.-\]\+\)', 'g'\)/mi);
  assert.match(sql, /CREATE TRIGGER trg_messages_notify_mentions[\s\S]*AFTER INSERT ON public\.messages/mi);
});
