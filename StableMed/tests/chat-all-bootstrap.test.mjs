import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CHAT_BOOTSTRAP_MIGRATION_PATH = new URL(
  "../supabase/migrations/20260215_step5_30_chat_bootstrap_actor_all_membership.sql",
  import.meta.url,
);
const AUTH_CONTEXT_PATH = new URL("../contexts/AuthContext.tsx", import.meta.url);

const chatBootstrapMigrationSql = readFileSync(CHAT_BOOTSTRAP_MIGRATION_PATH, "utf8");
const authContextSource = readFileSync(AUTH_CONTEXT_PATH, "utf8");

test("chat bootstrap migration exposes ensure_actor_all_chat_membership rpc", () => {
  assert.match(
    chatBootstrapMigrationSql,
    /CREATE OR REPLACE FUNCTION public\.ensure_actor_all_chat_membership\(/mi,
  );
  assert.match(
    chatBootstrapMigrationSql,
    /lower\(trim\(COALESCE\(c\.name, ''\)\)\)\s*=\s*'@all'/mi,
  );
  assert.match(
    chatBootstrapMigrationSql,
    /INSERT INTO public\.conversation_participants \(conversation_id, user_id\)/mi,
  );
});

test("auth context triggers @all membership bootstrap after profile fetch", () => {
  assert.match(authContextSource, /rpc\('ensure_actor_all_chat_membership'/mi);
  assert.match(authContextSource, /void ensureAllChatMembership\(userId\)/mi);
});
