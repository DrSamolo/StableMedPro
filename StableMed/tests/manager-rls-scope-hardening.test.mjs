import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MIGRATION_PATH = new URL(
  "../supabase/migrations/20260215_step5_35_manager_rls_scope_hardening.sql",
  import.meta.url,
);

const migrationSql = readFileSync(MIGRATION_PATH, "utf8");

test("manager rls hardening migration defines helper functions", () => {
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.get_profile_role\(p_user_id UUID\)/mi);
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.get_profile_team_id\(p_user_id UUID\)/mi);
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.is_manager_same_team\(/mi);
  assert.match(migrationSql, /SECURITY DEFINER/mi);
});

test("profiles policy uses manager team helper check", () => {
  assert.match(migrationSql, /DROP POLICY IF EXISTS profiles_select_self_or_admin ON public\.profiles/mi);
  assert.match(
    migrationSql,
    /CREATE POLICY profiles_select_self_or_admin ON public\.profiles[\s\S]*public\.get_profile_role\(auth\.uid\(\)\) = 'manager'[\s\S]*team_id IS NOT DISTINCT FROM public\.get_profile_team_id\(auth\.uid\(\)\)/mi,
  );
});

test("leads and deals policies use is_manager_same_team helper", () => {
  assert.match(migrationSql, /CREATE POLICY leads_select_scoped ON public\.leads[\s\S]*public\.is_manager_same_team\(auth\.uid\(\), user_id\)/mi);
  assert.match(migrationSql, /CREATE POLICY leads_insert_scoped ON public\.leads[\s\S]*public\.is_manager_same_team\(auth\.uid\(\), user_id\)/mi);
  assert.match(migrationSql, /CREATE POLICY leads_update_scoped ON public\.leads[\s\S]*public\.is_manager_same_team\(auth\.uid\(\), user_id\)/mi);
  assert.match(migrationSql, /CREATE POLICY deals_select_scoped ON public\.deals[\s\S]*public\.is_manager_same_team\(auth\.uid\(\), owner_id\)/mi);
  assert.match(migrationSql, /CREATE POLICY deals_insert_scoped ON public\.deals[\s\S]*public\.is_manager_same_team\(auth\.uid\(\), owner_id\)/mi);
  assert.match(migrationSql, /CREATE POLICY deals_update_scoped ON public\.deals[\s\S]*public\.is_manager_same_team\(auth\.uid\(\), owner_id\)/mi);
});
