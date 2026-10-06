import "server-only";

import { supabaseAdmin } from "@/lib/supabase-admin";

// PostgreSQL owns the limit and UTC date so all server instances share one quota.
export async function claimDailyAnalysisSlot(): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("claim_daily_ai_request");
  if (error) throw new Error(`Daily AI quota claim failed: ${error.message}`);
  if (data === null) return null;
  if (typeof data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new Error("Unexpected daily AI quota claim response.");
  }
  return data;
}

export async function releaseDailyAnalysisSlot(usageDate: string): Promise<void> {
  // Release once, against the claimed date rather than the current date.
  // A counter-only release must not be retried after an ambiguous RPC failure.
  const { error } = await supabaseAdmin.rpc("release_daily_ai_request", {
    p_usage_date: usageDate,
  });
  if (error) throw new Error(`Daily AI quota release failed: ${error.message}`);
}
