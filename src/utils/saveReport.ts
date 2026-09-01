import { supabase } from "@/integrations/supabase/client";

export interface SaveReportInput {
  blob: Blob;
  fileName: string;
  type: "pdf" | "excel";
  clientId: string | null;
  analysisId?: string | null;
  periodLabel?: string;
}

/** Uploads a just-generated PDF/Excel to the shared "reports" storage bucket and records it in the
 * `reports` table, so it can be reopened later (from History or the Clients page) instead of only
 * living as a one-time browser download. Best-effort: a failure here never blocks the download the
 * user already got, so callers should fire-and-forget this and only surface a soft warning. */
export const saveReportToStorage = async (input: SaveReportInput): Promise<boolean> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const folder = input.clientId || "sin-cliente";
    const path = `${folder}/${Date.now()}_${input.fileName}`;

    const { error: uploadError } = await supabase.storage.from("reports").upload(path, input.blob, {
      contentType:
        input.type === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { error: insertError } = await supabase.from("reports").insert({
      client_id: input.clientId,
      analysis_id: input.analysisId ?? null,
      type: input.type,
      period_label: input.periodLabel || "",
      file_name: input.fileName,
      storage_path: path,
      created_by: user?.id,
    });
    if (insertError) throw insertError;

    return true;
  } catch (err) {
    console.error("Could not save report to storage:", err);
    return false;
  }
};
