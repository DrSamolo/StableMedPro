<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run StableMed (Next.js)

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
