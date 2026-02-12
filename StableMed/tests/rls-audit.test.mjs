import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";

const BASE_SCHEMA_PATH = new URL("../supabase_schema.sql", import.meta.url);
const MIGRATION_PATH = new URL("../supabase/migrations/20260211_step1_rls_foundations.sql", import.meta.url);
const AUDIT_MIGRATION_PATH = new URL("../supabase/migrations/20260211_step1_2_audit_logging.sql", import.meta.url);
const ROLE_GUARDRAILS_MIGRATION_PATH = new URL("../supabase/migrations/20260211_step1_3_profile_role_guardrails.sql", import.meta.url);

const baseSchemaSql = readFileSync(BASE_SCHEMA_PATH, "utf8");
const migrationSql = readFileSync(MIGRATION_PATH, "utf8");
const auditMigrationSql = readFileSync(AUDIT_MIGRATION_PATH, "utf8");
const roleGuardrailsMigrationSql = readFileSync(ROLE_GUARDRAILS_MIGRATION_PATH, "utf8");

const tableNameSchema = z.string().regex(/^[a-z0-9_]+$/);
const tableNamesSchema = z.array(tableNameSchema).min(1);
const auditActionSchema = z.enum(["INSERT", "UPDATE", "DELETE"]);

function extractTables(sql) {
  const matches = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.([a-z0-9_]+)/gi)];
  return matches.map((m) => m[1].toLowerCase());
}

function extractAuditTriggerTables(sql) {
  const blockMatch = sql.match(/FOREACH sensitive_table IN ARRAY ARRAY\[(?<items>[\s\S]*?)\]\s*LOOP/i);
  if (!blockMatch?.groups?.items) {
    return [];
  }

  const matches = [...blockMatch.groups.items.matchAll(/'([a-z0-9_]+)'/gi)];
  return matches.map((m) => m[1].toLowerCase());
}

test("baseline schema tables are parseable", () => {
  const tables = extractTables(baseSchemaSql);
  const parsed = tableNamesSchema.parse(tables);
  assert.ok(parsed.includes("profiles"));
});

test("migration enables RLS on all public tables via dynamic loop", () => {
  assert.match(
    migrationSql,
    /WHERE n\.nspname = 'public'[\s\S]*ALTER TABLE public\..*ENABLE ROW LEVEL SECURITY/mi,
  );
  assert.match(migrationSql, /ALTER TABLE public\..*FORCE ROW LEVEL SECURITY/mi);
});

test("profiles select policy is scoped to self, admin, or manager same team", () => {
  assert.match(
    migrationSql,
    /CREATE POLICY profiles_select_self_or_admin ON public\.profiles[\s\S]*USING\s*\(\s*auth\.uid\(\)\s*=\s*id/mi,
  );
  assert.match(
    migrationSql,
    /manager_actor\.role\s*=\s*'manager'[\s\S]*manager_actor\.team_id\s*=\s*profiles\.team_id/mi,
  );
});

test("role update protection exists and enforces admin-only changes", () => {
  assert.match(
    migrationSql,
    /CREATE OR REPLACE FUNCTION public\.enforce_profile_role_update\(\)[\s\S]*Only admins can modify roles/mi,
  );
  assert.match(
    migrationSql,
    /IF NEW\.role IS DISTINCT FROM OLD\.role[\s\S]*NOT public\.is_admin\(auth\.uid\(\)\)/mi,
  );
});

test("role_permissions table is admin-managed", () => {
  assert.match(
    migrationSql,
    /CREATE POLICY role_permissions_admin_manage ON public\.role_permissions[\s\S]*public\.is_admin\(auth\.uid\(\)\)/mi,
  );
});

test("audit migration defines a complete audit_logs table", () => {
  assert.match(
    auditMigrationSql,
    /CREATE TABLE IF NOT EXISTS public\.audit_logs[\s\S]*user_id UUID[\s\S]*action TEXT NOT NULL[\s\S]*table_name TEXT NOT NULL[\s\S]*old_data JSONB[\s\S]*new_data JSONB[\s\S]*"timestamp" TIMESTAMP WITH TIME ZONE/mi,
  );
  assert.match(
    auditMigrationSql,
    /CHECK \(action IN \('INSERT', 'UPDATE', 'DELETE'\)\)/mi,
  );
});

test("audit migration function logs INSERT, UPDATE and DELETE payloads", () => {
  assert.match(
    auditMigrationSql,
    /CREATE OR REPLACE FUNCTION public\.audit_log_changes\(\)[\s\S]*SECURITY DEFINER/mi,
  );
  assert.match(auditMigrationSql, /IF TG_OP = 'INSERT'[\s\S]*to_jsonb\(NEW\)/mi);
  assert.match(
    auditMigrationSql,
    /IF TG_OP = 'UPDATE'[\s\S]*to_jsonb\(OLD\)[\s\S]*to_jsonb\(NEW\)/mi,
  );
  assert.match(auditMigrationSql, /IF TG_OP = 'DELETE'[\s\S]*to_jsonb\(OLD\)[\s\S]*NULL/mi);

  const actions = ["INSERT", "UPDATE", "DELETE"];
  for (const action of actions) {
    auditActionSchema.parse(action);
  }
});

test("audit migration attaches triggers to all sensitive tables", () => {
  const expectedSensitiveTables = tableNamesSchema.parse([
    "teams",
    "profiles",
    "leads",
    "deals",
    "trainings",
    "deal_trainings",
    "comments",
    "role_permissions",
    "invitations",
    "app_settings",
  ]);

  const auditedTables = tableNamesSchema.parse(extractAuditTriggerTables(auditMigrationSql));
  assert.deepEqual(auditedTables, expectedSensitiveTables);
  assert.match(
    auditMigrationSql,
    /AFTER INSERT OR UPDATE OR DELETE ON public\./mi,
  );
});

test("role guardrails migration normalizes and constrains profile role values", () => {
  assert.match(
    roleGuardrailsMigrationSql,
    /UPDATE public\.profiles[\s\S]*SET role = lower\(trim\(role\)\)/mi,
  );
  assert.match(
    roleGuardrailsMigrationSql,
    /SET role = 'commercial'[\s\S]*role NOT IN \('admin', 'manager', 'commercial'\)/mi,
  );
  assert.match(
    roleGuardrailsMigrationSql,
    /ADD CONSTRAINT profiles_role_allowed[\s\S]*CHECK \(role IN \('admin', 'manager', 'commercial'\)\)/mi,
  );
});
