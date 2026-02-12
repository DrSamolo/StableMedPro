import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type LeadRow = {
  id: string;
  name: string | null;
  user_id: string | null;
};

type FetchMode = "last_contact_at" | "last_activity";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function fetchInactiveLeads(cutoffIso: string): Promise<{
  leads: LeadRow[];
  mode: FetchMode;
}> {
  const primary = await supabaseAdmin
    .from("leads")
    .select("id,name,user_id")
    .lt("last_contact_at", cutoffIso)
    .not("user_id", "is", null);

  if (!primary.error) {
    return { leads: (primary.data ?? []) as LeadRow[], mode: "last_contact_at" };
  }

  console.log(
    `[scan-inactive-leads] fallback to last_activity because last_contact_at query failed: ${primary.error.message}`,
  );

  const fallback = await supabaseAdmin
    .from("leads")
    .select("id,name,user_id")
    .lt("last_activity", cutoffIso)
    .not("user_id", "is", null);

  if (fallback.error) {
    throw fallback.error;
  }

  return { leads: (fallback.data ?? []) as LeadRow[], mode: "last_activity" };
}

Deno.serve(async () => {
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const cutoffIso = cutoff.toISOString();

    const { leads, mode } = await fetchInactiveLeads(cutoffIso);
    if (!leads.length) {
      console.log(
        `[scan-inactive-leads] no inactive leads found (mode=${mode}, cutoff=${cutoffIso})`,
      );
      return new Response(
        JSON.stringify({
          scanned: 0,
          created_tasks: 0,
          created_notifications: 0,
          mode,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const leadIds = leads.map((lead) => lead.id);
    const existingTasksResult = await supabaseAdmin
      .from("tasks")
      .select("lead_id,status")
      .in("lead_id", leadIds)
      .in("status", ["todo", "in_progress"]);

    if (existingTasksResult.error) {
      throw existingTasksResult.error;
    }

    const leadIdsWithOpenTask = new Set(
      (existingTasksResult.data ?? [])
        .map((task) => task.lead_id as string | null)
        .filter((leadId): leadId is string => Boolean(leadId)),
    );

    const targetLeads = leads.filter((lead) =>
      Boolean(lead.user_id) && !leadIdsWithOpenTask.has(lead.id)
    );

    let createdTasks = 0;
    let createdNotifications = 0;

    for (const lead of targetLeads) {
      const safeLeadName = (lead.name ?? "Lead").trim() || "Lead";
      const ownerId = lead.user_id as string;

      const taskInsert = await supabaseAdmin
        .from("tasks")
        .insert({
          user_id: ownerId,
          lead_id: lead.id,
          title: `Relance : ${safeLeadName}`,
          description: "Lead inactif depuis 7 jours. Une relance est conseillee.",
          priority: "high",
          status: "todo",
          due_at: now.toISOString(),
        })
        .select("id")
        .single();

      if (taskInsert.error) {
        console.log(
          `[scan-inactive-leads] failed to create task for lead=${lead.id}: ${taskInsert.error.message}`,
        );
        continue;
      }

      createdTasks += 1;

      const notificationInsert = await supabaseAdmin.from("notifications").insert({
        user_id: ownerId,
        type: "system",
        title: "Lead a risque detecte",
        message: `Une tache de relance a ete creee pour ${safeLeadName}.`,
        metadata: {
          lead_id: lead.id,
          task_id: taskInsert.data.id,
          source: "scan-inactive-leads",
        },
        is_read: false,
      });

      if (notificationInsert.error) {
        console.log(
          `[scan-inactive-leads] failed to create notification for lead=${lead.id}: ${notificationInsert.error.message}`,
        );
        continue;
      }

      createdNotifications += 1;
    }

    console.log(
      `[scan-inactive-leads] scanned=${leads.length} eligible=${targetLeads.length} tasks=${createdTasks} notifications=${createdNotifications} mode=${mode}`,
    );

    return new Response(
      JSON.stringify({
        scanned: leads.length,
        eligible: targetLeads.length,
        created_tasks: createdTasks,
        created_notifications: createdNotifications,
        mode,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.log(`[scan-inactive-leads] fatal error: ${message}`);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
