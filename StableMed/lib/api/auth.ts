import { ApiError } from "./errors";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/route-handler-client";

export async function requireApiUser() {
  const supabase = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ApiError(401, "UNAUTHORIZED", "Utilisateur non authentifie");
  }

  return { supabase, user };
}

export async function requireApiAdmin() {
  const { supabase, user } = await requireApiUser();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile || profile.role !== "admin") {
    throw new ApiError(403, "FORBIDDEN", "Acces reserve aux admins");
  }

  return { supabase, user, profile };
}
