import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const TEAM_SCOPE_MIGRATION_PATH = new URL(
  "../supabase/migrations/20260215_step5_32_manager_scope_v2_and_schema_reload.sql",
  import.meta.url,
);
const TEAM_ASSIGN_MIGRATION_PATH = new URL(
  "../supabase/migrations/20260215_step5_33_manager_team_bootstrap_claim.sql",
  import.meta.url,
);
const ROLE_NORMALIZATION_HOTFIX_PATH = new URL(
  "../supabase/migrations/20260215_step5_34_role_normalization_trigger_safe_reassert.sql",
  import.meta.url,
);
const SETTINGS_PAGE_PATH = new URL("../components/settings/settings-page.tsx", import.meta.url);
const DATA_CONTEXT_PATH = new URL("../contexts/DataContext.tsx", import.meta.url);
const AUTH_CONTEXT_PATH = new URL("../contexts/AuthContext.tsx", import.meta.url);

const teamScopeMigrationSql = readFileSync(TEAM_SCOPE_MIGRATION_PATH, "utf8");
const teamAssignMigrationSql = readFileSync(TEAM_ASSIGN_MIGRATION_PATH, "utf8");
const roleNormalizationHotfixSql = readFileSync(ROLE_NORMALIZATION_HOTFIX_PATH, "utf8");
const settingsPageSource = readFileSync(SETTINGS_PAGE_PATH, "utf8");
const dataContextSource = readFileSync(DATA_CONTEXT_PATH, "utf8");
const authContextSource = readFileSync(AUTH_CONTEXT_PATH, "utf8");

test("team assignment v2 rpc allows admin and constrained manager flow", () => {
  assert.match(
    teamAssignMigrationSql,
    /CREATE OR REPLACE FUNCTION public\.assign_user_team_v2\(\s*p_user_id UUID,\s*p_team_id UUID DEFAULT NULL\s*\)/mi,
  );
  assert.match(
    teamAssignMigrationSql,
    /SELECT lower\(trim\(COALESCE\(p\.role, ''\)\)\), p\.team_id\s*INTO actor_role, actor_team/mi,
  );
  assert.match(teamAssignMigrationSql, /ELSIF actor_role = 'manager' THEN/mi);
  assert.match(teamAssignMigrationSql, /Bootstrap: manager can set his own team once when currently unassigned/mi);
  assert.match(teamAssignMigrationSql, /IF p_user_id = actor_id AND p_team_id IS NOT NULL THEN/mi);
  assert.match(teamAssignMigrationSql, /Un manager ne peut affecter qu''a son equipe/mi);
  assert.match(teamAssignMigrationSql, /Un manager ne peut affecter que des utilisateurs sans equipe/mi);
  assert.match(teamAssignMigrationSql, /UPDATE public\.profiles p\s*SET team_id = p_team_id/mi);
});

test("team management visibility rpc exists for manager own-team plus unassigned users", () => {
  assert.match(
    teamScopeMigrationSql,
    /CREATE OR REPLACE FUNCTION public\.get_team_management_profiles_v2\(\)/mi,
  );
  assert.match(
    teamScopeMigrationSql,
    /p\.team_id IS NOT DISTINCT FROM actor_team[\s\S]*OR \(p\.team_id IS NULL/mi,
  );
});

test("settings page uses team assignment rpc and manager assignment controls", () => {
  assert.match(settingsPageSource, /rpc\('assign_user_team_v2'/mi);
  assert.match(settingsPageSource, /rpc\('get_team_management_profiles_v2'\)/mi);
  assert.match(settingsPageSource, /Définir mon équipe/mi);
  assert.match(settingsPageSource, /Affecter a mon equipe/mi);
  assert.match(settingsPageSource, /onClick=\{\(\) => handleChangeTeam\(member\.id, managerCurrentTeamId\)\}/mi);
  assert.match(settingsPageSource, /teamNameById\.get\(member\.team_id\)/mi);
  assert.doesNotMatch(
    settingsPageSource,
    /from\('profiles'\)\s*\.update\(\{\s*team_id:\s*val\s*\}\)\s*\.eq\('id', userId\)/mi,
  );
});

test("data context uses manager/admin team-management rpc for global filters", () => {
  assert.match(dataContextSource, /rpc\('get_team_management_profiles_v2'\)/mi);
  assert.match(dataContextSource, /\(isAdmin \|\| isManager\)/mi);
  assert.match(dataContextSource, /isManager && profile\.team_id && rows\.length === 0/mi);
  assert.match(dataContextSource, /managerEffectiveTeamId/mi);
  assert.match(dataContextSource, /channel\(`data-context-profile-\$\{profileId\}`\)/mi);
  assert.match(dataContextSource, /filter:\s*`id=eq\.\$\{profileId\}`/mi);
  assert.match(dataContextSource, /setSelectedUserId\('all'\)/mi);
});

test("role normalization hotfix enables trigger-safe normalization for manager RLS checks", () => {
  assert.match(
    roleNormalizationHotfixSql,
    /SELECT set_config\('app\.allow_invitation_role_sync', 'on', true\)/mi,
  );
  assert.match(
    roleNormalizationHotfixSql,
    /UPDATE public\.profiles[\s\S]*SET role = lower\(trim\(role\)\)/mi,
  );
  assert.match(
    roleNormalizationHotfixSql,
    /NEW\.role := lower\(trim\(COALESCE\(NEW\.role, 'commercial'\)\)\)/mi,
  );
});

test("auth context force-refreshes profile when app returns to foreground", () => {
  assert.match(authContextSource, /window\.addEventListener\('focus', refreshOnForeground\)/mi);
  assert.match(authContextSource, /document\.addEventListener\('visibilitychange', handleVisibility\)/mi);
  assert.match(authContextSource, /fetchProfile\(currentUserId, \{ force: true \}\)/mi);
});
