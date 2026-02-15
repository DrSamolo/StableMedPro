<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run SudMed CRM (Next.js)

This project now runs on Next.js (App Router) with Supabase.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set Supabase env vars in `.env.local`:
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Run the app:
   `npm run dev`

## Build

`npm run build`

## Supabase migrations to apply

Run SQL migrations in this order:
1. `supabase/migrations/20260211_step1_rls_foundations.sql`
2. `supabase/migrations/20260211_step1_2_audit_logging.sql`
3. `supabase/migrations/20260211_step1_3_profile_role_guardrails.sql`
4. `supabase/migrations/20260211_step2_1_tasks_notifications.sql`
5. `supabase/migrations/20260211_step2_2_task_created_notification_trigger.sql`
6. `supabase/migrations/20260211_step3_1_chat_collaboration.sql`
7. `supabase/migrations/20260211_step3_2_chat_conversations_core.sql`
8. `supabase/migrations/20260211_step3_3_notifications_realtime.sql`
9. `supabase/migrations/20260211_step3_4_chat_create_conversation_rpc.sql`
10. `supabase/migrations/20260211_step3_5_chat_participants_and_mentions_rpc.sql`
11. `supabase/migrations/20260211_step3_6_chat_candidates_dm_hardening.sql`
12. `supabase/migrations/20260212_step3_7_sales_chat_all_hands.sql`
13. `supabase/migrations/20260212_step3_8_chat_conversation_summaries_rpc.sql`
14. `supabase/migrations/20260212_step3_9_chat_unread_total_rpc.sql`
15. `supabase/migrations/20260212_step5_1_avatars_storage_bucket_policies.sql`
16. `supabase/migrations/20260213_step5_2_profiles_backfill_and_auth_trigger.sql`
17. `supabase/migrations/20260213_step5_3_sync_missing_profiles_rpc.sql`
18. `supabase/migrations/20260213_step5_4_visible_profiles_rpc.sql`
19. `supabase/migrations/20260213_step5_5_delete_team_secure_rpc.sql`
20. `supabase/migrations/20260213_step5_6_delete_user_secure_rpc.sql`
21. `supabase/migrations/20260213_step5_7_lead_trainings_association_table.sql`
22. `supabase/migrations/20260213_step5_8_sales_chat_all_hands_wording_refresh.sql`
23. `supabase/migrations/20260213_step5_9_delete_user_secure_hardening.sql`
24. `supabase/migrations/20260213_step5_10_consume_invitation_token_rpc.sql`
25. `supabase/migrations/20260213_step5_11_delete_user_secure_reassign_audit_logs.sql`
26. `supabase/migrations/20260213_step5_12_lead_profession_options_rpc.sql`
27. `supabase/migrations/20260213_step5_13_chat_access_matrix_and_all_visibility.sql`
28. `supabase/migrations/20260213_step5_14_security_performance_hardening.sql`
29. `supabase/migrations/20260213_step5_15_bulk_leads_ops_and_edge_auth.sql`
30. `supabase/migrations/20260213_step5_16_purge_mock_leads_data_rpc.sql`
31. `supabase/migrations/20260213_step5_17_wipe_crm_runtime_data_rpc.sql`
32. `supabase/migrations/20260215_step5_26_invitation_signup_finalize_atomic.sql`
33. `supabase/migrations/20260215_step5_27_invitation_finalize_preserve_manual_team.sql`
34. `supabase/migrations/20260215_step5_28_assign_user_team_rpc.sql`
35. `supabase/migrations/20260215_step5_29_manager_team_scope_and_assignment.sql`
36. `supabase/migrations/20260215_step5_30_chat_bootstrap_actor_all_membership.sql`
37. `supabase/migrations/20260215_step5_31_profile_role_reassert_normalization.sql`
38. `supabase/migrations/20260215_step5_32_manager_scope_v2_and_schema_reload.sql`
39. `supabase/migrations/20260215_step5_33_manager_team_bootstrap_claim.sql`

To purge perf/mock leads after migrations (admin only):
`select public.purge_mock_leads_data('PURGE_MOCK_LEADS');`

To wipe all CRM runtime data while keeping structure/users/permissions (admin only):
`select public.wipe_crm_runtime_data('WIPE_CRM_RUNTIME_DATA');`

## Handoff and Maintenance Notes

- Current handoff context (pre-prod state, hardening changes, upgrade checklist):
  - `docs/agent_handoff_2026-02-13.md`
- Security audit:
  - `docs/security_audit_2026-02-13.md`
- 100k load plan:
  - `docs/load_plan_100k_leads_2026-02-13.md`
- API foundation:
  - `docs/api_foundation_2026-02-13.md`
