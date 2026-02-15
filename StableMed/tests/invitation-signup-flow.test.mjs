import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INVITATION_FINALIZE_MIGRATION_PATH = new URL(
  "../supabase/migrations/20260215_step5_27_invitation_finalize_preserve_manual_team.sql",
  import.meta.url,
);
const REGISTER_PAGE_PATH = new URL("../components/auth/register-page.tsx", import.meta.url);
const LOGIN_PAGE_PATH = new URL("../components/auth/login-page.tsx", import.meta.url);

const invitationFinalizeMigrationSql = readFileSync(INVITATION_FINALIZE_MIGRATION_PATH, "utf8");
const registerPageSource = readFileSync(REGISTER_PAGE_PATH, "utf8");
const loginPageSource = readFileSync(LOGIN_PAGE_PATH, "utf8");

test("invitation finalization migration preserves manual team assignment and role upgrades from default", () => {
  assert.match(
    invitationFinalizeMigrationSql,
    /CREATE OR REPLACE FUNCTION public\.finalize_invitation_signup\(\s*p_token UUID,\s*p_full_name TEXT DEFAULT NULL\s*\)/mi,
  );
  assert.match(
    invitationFinalizeMigrationSql,
    /lower\(trim\(actor_email\)\)\s*<>\s*lower\(trim\(invitation_row\.email\)\)/mi,
  );
  assert.match(
    invitationFinalizeMigrationSql,
    /SET used_at = timezone\('utc'::text, now\(\)\)/mi,
  );
  assert.match(
    invitationFinalizeMigrationSql,
    /set_config\('app\.allow_invitation_role_sync', 'on', true\)/mi,
  );
  assert.match(
    invitationFinalizeMigrationSql,
    /team_id = COALESCE\(public\.profiles\.team_id, invitation_row\.team_id\)/mi,
  );
  assert.match(
    invitationFinalizeMigrationSql,
    /WHEN public\.profiles\.role = 'commercial' THEN normalized_role/mi,
  );
});

test("register page finalizes invitation via rpc and keeps token errors separate from submit errors", () => {
  assert.match(registerPageSource, /rpc\('finalize_invitation_signup'/mi);
  assert.doesNotMatch(registerPageSource, /from\('profiles'\)\s*\.upsert/mi);
  assert.doesNotMatch(registerPageSource, /rpc\('consume_invitation_token'/mi);
  assert.match(registerPageSource, /setTokenError\(/mi);
  assert.match(registerPageSource, /setSubmitError\(/mi);
  assert.match(registerPageSource, /pending_invitation_signup/mi);
});

test("login page consumes pending invitation context and finalizes after sign-in", () => {
  assert.match(loginPageSource, /pending_invitation_signup/mi);
  assert.match(loginPageSource, /rpc\('finalize_invitation_signup'/mi);
  assert.match(loginPageSource, /localStorage\.removeItem\(PENDING_INVITATION_STORAGE_KEY\)/mi);
});
