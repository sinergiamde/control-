import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const SYSTEM_PROMPT = `Lees recibos y facturas de compra para CTRL+ by TaxForYou (contabilidad de pequeñas empresas en EE.UU.).

Extrae del recibo adjunto:
- date: la fecha de la compra en formato YYYY-MM-DD ("" si no aparece).
- merchant: el nombre del comercio o proveedor tal como aparece ("" si no aparece).
- total: el monto TOTAL pagado, incluidos impuestos y propina (0 si no aparece).
- tax: la suma de los impuestos (sales tax, IVA, etc.); 0 si el recibo no muestra impuestos.
- currency: código ISO de la moneda (normalmente "USD").
- *_confident: true solo si leíste ese dato con claridad; false si la foto está borrosa, cortada, el texto es ambiguo o tuviste que adivinar.
- is_receipt: false si la imagen no es un recibo o factura.

No inventes datos: si no estás seguro, deja el valor vacío o en 0 y marca *_confident en false.`;

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    date: { type: "string" },
    merchant: { type: "string" },
    total: { type: "number" },
    tax: { type: "number" },
    currency: { type: "string" },
    date_confident: { type: "boolean" },
    merchant_confident: { type: "boolean" },
    total_confident: { type: "boolean" },
    tax_confident: { type: "boolean" },
    is_receipt: { type: "boolean" },
  },
  required: [
    "date", "merchant", "total", "tax", "currency",
    "date_confident", "merchant_confident", "total_confident", "tax_confident", "is_receipt",
  ],
  additionalProperties: false,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Reading a receipt is a paid AI call: signed-in users only, and only while their plan is active.
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return json({ error: "Debes iniciar sesión para leer un recibo." }, 401);
    }
    const { data: allowed } = await supabaseClient.rpc("can_upload");
    if (allowed === false) {
      return json({ error: "Tu prueba gratuita terminó. Suscríbete para seguir subiendo recibos." }, 402);
    }

    const { fileBase64, mediaType } = await req.json();
    if (!fileBase64 || typeof fileBase64 !== "string") {
      return json({ error: "Falta el archivo (fileBase64)." }, 400);
    }
    const type = String(mediaType || "").toLowerCase();
    const isPdf = type.includes("pdf");
    if (!isPdf && !IMAGE_TYPES.includes(type)) {
      return json({ error: "Formato no soportado. Usa JPG, PNG, WEBP o PDF." }, 400);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const fileBlock = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }
      : { type: "image", source: { type: "base64", media_type: type, data: fileBase64 } };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        thinking: { type: "disabled" },
        output_config: {
          format: { type: "json_schema", schema: RECEIPT_SCHEMA },
        },
        messages: [{ role: "user", content: [fileBlock, { type: "text", text: "Extrae los datos de este recibo." }] }],
      }),
    });

    if (!response.ok) {
      console.error("extract-receipt Anthropic error:", response.status, await response.text());
      return json({ error: "La lectura del recibo con IA falló." }, 500);
    }

    const completion = await response.json();
    if (completion.stop_reason === "refusal") {
      return json({ error: "El modelo no pudo procesar este archivo." }, 422);
    }
    const textBlock = Array.isArray(completion.content)
      ? completion.content.find((b: any) => b.type === "text")
      : null;
    if (!textBlock?.text) {
      throw new Error(`La respuesta no incluyó contenido (stop_reason: ${completion.stop_reason || "desconocido"}).`);
    }

    return json(JSON.parse(textBlock.text));
  } catch (error) {
    console.error("extract-receipt error:", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
