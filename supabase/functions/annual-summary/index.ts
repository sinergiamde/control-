import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
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

type AnalysisRow = {
  user_id: string;
  revenues_total: number | null;
  cogs_total: number | null;
  opex_total: number | null;
  personal_total: number | null;
  fees_total: number | null;
  full_analysis: any;
  created_at: string;
};

/** Summarizes one user's rows for one calendar year (Jan 1 -> Dec 31) and upserts the result.
 * Shared by both the yearly cron sweep and the on-demand single-user path below so the two never
 * drift out of sync on what "the annual summary" actually contains. */
async function summarizeYear(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  year: number,
  rows: AnalysisRow[]
) {
  const totals = { revenues: 0, cogs: 0, opex: 0, personal: 0, fees: 0 };
  const categories: Record<string, number> = {};

  for (const r of rows) {
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
        year,
        revenues_total: totals.revenues,
        cogs_total: totals.cogs,
        opex_total: totals.opex,
        personal_total: totals.personal,
        fees_total: totals.fees,
        net_income: netIncome,
        categories,
        statements_count: rows.length,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,year" }
    );

  if (upsertError) throw upsertError;
  return { statements_count: rows.length };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const CRON_SECRET = Deno.env.get("CRON_SECRET");
    const cronSecretHeader = req.headers.get("x-cron-secret");

    // Path 1: the yearly cron sweep — uses the service-role key to read/rewrite EVERY user's
    // data, bypassing RLS, so it must only ever run from our own pg_cron schedule.
    if (cronSecretHeader) {
      if (!CRON_SECRET || cronSecretHeader !== CRON_SECRET) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const targetYear = new Date().getUTCFullYear() - 1;
      const yearStart = `${targetYear}-01-01T00:00:00Z`;
      const yearEnd = `${targetYear + 1}-01-01T00:00:00Z`;

      const { data: rows, error } = await supabase
        .from("analyses")
        .select("user_id, revenues_total, cogs_total, opex_total, personal_total, fees_total, full_analysis, created_at")
        .gte("created_at", yearStart)
        .lt("created_at", yearEnd);
      if (error) throw error;

      const byUser = new Map<string, AnalysisRow[]>();
      for (const row of (rows || []) as AnalysisRow[]) {
        const arr = byUser.get(row.user_id) || [];
        arr.push(row);
        byUser.set(row.user_id, arr);
      }

      let generated = 0;
      for (const [userId, userRows] of byUser.entries()) {
        try {
          await summarizeYear(supabase, userId, targetYear, userRows);
          generated++;
        } catch (err) {
          console.error(`annual-summary upsert failed for user ${userId}:`, err instanceof Error ? err.message : err);
        }
      }

      return new Response(JSON.stringify({ year: targetYear, users_summarized: generated }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Path 2: on-demand, self-service — a logged-in user asking "(re)generate MY annual summary
    // for year X" from the History page, instead of waiting on the once-a-year cron. Identity is
    // verified against the caller's own JWT; the service-role key is only ever used to read/write
    // that one verified user's own rows, never anyone else's.
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const year = Number(body?.year);
    const currentYear = new Date().getUTCFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > currentYear) {
      return new Response(JSON.stringify({ error: "Invalid year" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const yearStart = `${year}-01-01T00:00:00Z`;
    const yearEnd = `${year + 1}-01-01T00:00:00Z`;

    const { data: rows, error } = await supabase
      .from("analyses")
      .select("user_id, revenues_total, cogs_total, opex_total, personal_total, fees_total, full_analysis, created_at")
      .eq("user_id", user.id)
      .gte("created_at", yearStart)
      .lt("created_at", yearEnd);
    if (error) throw error;

    const result = await summarizeYear(supabase, user.id, year, (rows || []) as AnalysisRow[]);

    return new Response(JSON.stringify({ year, ...result }), {
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
