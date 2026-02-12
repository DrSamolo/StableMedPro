import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CHAT_MIGRATION_PATH = new URL(
  "../supabase/migrations/20260211_step3_1_chat_collaboration.sql",
  import.meta.url,
);

const chatMigrationSql = readFileSync(CHAT_MIGRATION_PATH, "utf8");

test("chat migration creates channel/message tables with strict constraints", () => {
  assert.match(
    chatMigrationSql,
    /CREATE TABLE IF NOT EXISTS public\.chat_channels[\s\S]*team_id UUID NOT NULL[\s\S]*CONSTRAINT chat_channels_unique_team_slug UNIQUE \(team_id, slug\)/mi,
  );

  assert.match(
    chatMigrationSql,
    /CREATE TABLE IF NOT EXISTS public\.chat_messages[\s\S]*sender_id UUID NOT NULL[\s\S]*CONSTRAINT chat_messages_body_max_length CHECK \(length\(body\) <= 4000\)/mi,
  );
});

test("chat migration enforces RLS on channel/message tables", () => {
  assert.match(chatMigrationSql, /ALTER TABLE public\.chat_channels ENABLE ROW LEVEL SECURITY/mi);
  assert.match(chatMigrationSql, /ALTER TABLE public\.chat_channels FORCE ROW LEVEL SECURITY/mi);
  assert.match(chatMigrationSql, /ALTER TABLE public\.chat_messages ENABLE ROW LEVEL SECURITY/mi);
  assert.match(chatMigrationSql, /ALTER TABLE public\.chat_messages FORCE ROW LEVEL SECURITY/mi);

  assert.match(
    chatMigrationSql,
    /CREATE POLICY chat_channels_select_team ON public\.chat_channels[\s\S]*public\.can_access_team\(team_id\)/mi,
  );

  assert.match(
    chatMigrationSql,
    /CREATE POLICY chat_messages_insert_channel_member ON public\.chat_messages[\s\S]*sender_id = auth\.uid\(\)/mi,
  );
});

test("chat migration seeds default general channels and wires realtime publication", () => {
  assert.match(
    chatMigrationSql,
    /INSERT INTO public\.chat_channels[\s\S]*'General'[\s\S]*'general'/mi,
  );

  assert.match(chatMigrationSql, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.chat_channels/mi);
  assert.match(chatMigrationSql, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.chat_messages/mi);
});
