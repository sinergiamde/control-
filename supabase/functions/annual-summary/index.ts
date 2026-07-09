import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(value);
  return 0;
};

const addCategory = (categories: Record<string, number>, name: string, amount: unknown) => {
  const cleanName = String(name || "Sin categoría").trim();
  const cleanAmount = toNumber(amount);
  if (cleanAmount > 0) categories[cleanName] = (categories[cleanName] || 0) + cleanAmount;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Runs every Jan 1 -> summarizes the year that just ended
    const targetYear = new Date().getUTCFullYear() - 1;
    const yearStart = `${targetYear}-01-01T00:00:00Z`;
    const yearEnd = `${targetYear + 1}-01-01T00:00:00Z`;

    const { data: rows, error } = await supabase
      .from("analyses")
      .select("user_id, revenues_total, cogs_total, opex_total, personal_total, fees_total, total_spent, full_analysis, created_at")
      .gte("created_at", yearStart)
      .lt("created_at", yearEnd);

    if (error) throw error;

    const byUser = new Map<string, typeof rows>();
    for (const row of rows || []) {
      const arr = byUser.get(row.user_id) || [];
      arr.push(row);
      byUser.set(row.user_id, arr);
    }

    let generated = 0;
    for (const [userId, userRows] of byUser.entries()) {
      const totals = { revenues: 0, cogs: 0, opex: 0, personal: 0, fees: 0 };
      const categories: Record<string, number> = {};

      for (const r of userRows) {
        totals.revenues += toNumber(r.revenues_total);
        totals.cogs += toNumber(r.cogs_total);
        totals.opex += toNumber(r.opex_total);
        totals.personal += toNumber(r.personal_total);
        totals.fees += toNumber(r.fees_total);

        const source = (r.full_analysis as any)?.analysis ?? r.full_analysis;
        ["cogs", "opex", "fees", "personal"].forEach((key) => {
          if (Array.isArray(source?.[key])) {
            source[key].forEach((item: any) =>
              addCategory(categories, item?.desc || item?.category || key, item?.amt ?? item?.amount)
            );
          }
        });
      }

      const netIncome = totals.revenues - (totals.cogs + totals.opex + totals.personal + totals.fees);

      const { error: upsertError } = await supabase
        .from("annual_summaries")
        .upsert(
          {
            user_id: userId,
            year: targetYear,
            revenues_total: totals.revenues,
            cogs_total: totals.cogs,
            opex_total: totals.opex,
            personal_total: totals.personal,
            fees_total: totals.fees,
            net_income: netIncome,
            categories,
            statements_count: userRows.length,
            generated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,year" }
        );

      if (upsertError) {
        console.error(`annual-summary upsert failed for user ${userId}:`, upsertError.message);
        continue;
      }
      generated++;
    }

    return new Response(JSON.stringify({ year: targetYear, users_summarized: generated }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("annual-summary error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
