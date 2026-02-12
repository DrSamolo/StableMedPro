# Audit RLS - Step 1.1 (Fondations Securite & Backend)

## Scope
- Source analysee: `StableMed/supabase_schema.sql`
- Tables auditees: `teams`, `profiles`, `leads`, `deals`, `trainings`, `deal_trainings`, `comments`, `role_permissions`, `invitations`, `app_settings`

## Constat initial
- RLS etait activee sur les tables, mais plusieurs politiques etaient trop permissives (`FOR ALL USING (auth.role() = 'authenticated')`).
- `profiles` autorisait la lecture de tous les profils pour tout utilisateur authentifie.
- Le controle "seul admin peut modifier les roles" n'etait pas enforce explicitement au niveau DB (risque de bypass via API/SQL direct).

## Correctifs livres
- Migration: `StableMed/supabase/migrations/20260211_step1_rls_foundations.sql`
- Activation RLS + FORCE RLS sur toutes les tables du schema `public`.
- Recreation complete des policies avec scope par role et ownership.
- Politique `profiles` basee sur `auth.uid()` pour lecture self (exception admin).
- Trigger de securite `enforce_profile_role_update` pour bloquer tout changement de `profiles.role` par un non-admin.
- Politique `role_permissions_admin_manage` reservee admin.

## Validation automatisee
- Tests unitaires: `StableMed/tests/rls-audit.test.mjs`
- Couvre:
  - Presence de l'activation RLS globale.
  - Presence de la policy `profiles_select_self_or_admin` basee sur `auth.uid()`.
  - Presence de la protection admin-only sur modification de role.
  - Presence de la policy admin-only sur `role_permissions`.
