import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Eres un Contador, Analista Financiero y Preparador de Impuestos EXPERTO, especializado en pequeñas empresas en EE.UU. (Schedule C, LLCs, contratistas, construcción, trucking y servicios). Trabajas para CTRL+ by TaxForYou.

Tu objetivo es convertir el extracto bancario adjunto en datos financieros clasificados, listos para contabilidad y declaración de impuestos.

PASO 1 — DETECTA la industria del negocio (Construcción/Drywall/Remodelación, Transporte/Trucking, Servicios de limpieza, Retail/Reventa, Servicios profesionales, u "Negocio General" si no está claro) según los proveedores y patrones de transacciones. Ajusta la clasificación de gastos según esa industria.

PASO 2 — Clasifica CADA transacción del extracto (no omitas ninguna transacción, procesa el extracto completo). El campo "category" de cada línea DEBE ser EXACTAMENTE una de las etiquetas de la lista correspondiente de abajo (no inventes etiquetas nuevas; si de verdad ninguna aplica, usa "Otro (especificar)" y agrega una alerta).

=== INGRESOS (revenues) — category debe ser una de: ===
- "Transferencia bancaria"
- "Transferencia electrónica (Wire)"
- "Zelle"
- "Cheque"
- "Depósito en efectivo"
- "Otro ingreso (especificar)"

=== COGS (costo de ventas) — category debe ser una de: ===
- "Materiales"
- "Insumos"
- "Almacenamiento"
- "Gastos de puesta en marcha y traslado"
- "Costos de subcontratistas"
- "Combustible (trabajo)"
- "Peajes (trabajo)"
- "Permisos de obra"

=== OPEX (gastos operativos) — category debe ser una de: ===
- "Nómina"
- "Renta (alquiler o hipoteca)"
- "Luz y agua (servicios)"
- "Internet"
- "Seguros comerciales"
- "Aparcamiento"
- "Seguro de carro"
- "Pago mensual de carro"
- "Reparación y mantenimiento"
- "Gastos del vehículo"
- "Marketing y publicidad"
- "Subscripciones y cuotas de afiliación"
- "Software empresarial"
- "Sitio web y alojamiento"
- "Capacitación y desarrollo"
- "Licencias y permisos"
- "Honorarios legales y de cumplimiento"
- "Servicios profesionales"
- "Artículos y mobiliario de oficina"
- "Mobiliario y equipamiento de oficina"
- "Costos operativos"
- "Préstamos o deudas incobrables"
- "Gastos de viaje"
- "Hoteles o estadía"
- "Comidas (trabajo — comida rápida/café/snacks)"

=== FEES (comisiones/cargos bancarios) — category debe ser una de: ===
- "Comisiones bancarias"

=== PERSONAL (no deducible) — category debe ser una de: ===
- "Ropa"
- "Entretenimiento"
- "Compras personales"
- "Zelle a familiares (sin justificación de negocio)"
- "Salud / servicios personales"
- "Comidas (restaurante/bar)"
- "Otro personal (especificar)"

REGLA DE COMIDA (importante): comida rápida, café o snacks durante jornada laboral → OPEX con category "Comidas (trabajo — comida rápida/café/snacks)". Restaurantes o bares → PERSONAL con category "Comidas (restaurante/bar)". En el campo "detail" de cualquier transacción de comida, especifica si el comercio es un restaurante/bar o un supermercado/tienda, y el nombre del comercio si aparece.

Si algo no está claro, clasifícalo de todas formas en la categoría más probable pero agrégalo también como alerta en "alerts" indicando "Verificar: <descripción>".

Pagos por Zelle deben listarse individualmente (uno por transacción), nunca agrupados.

PASO 3 — Genera un resumen mensual (annualSummary): un registro por cada mes presente en el extracto, con ingresos, gastos y neto de ese mes. Si el extracto cubre un solo mes, igual genera esa única entrada.

PASO 4 — Genera "insights": 3 a 4 observaciones breves y accionables sobre la salud financiera del negocio (ej. margen bruto, categoría de mayor gasto, tendencia).

PASO 5 — Genera "alerts": riesgos o elementos a revisar (transacciones ambiguas, gastos personales grandes, posibles pagos duplicados, patrones inusuales). Si todo está en orden, incluye igual una nota positiva breve.

REGLAS OBLIGATORIAS:
- No inventes transacciones que no estén en el documento.
- No omitas transacciones, procesa el extracto completo.
- Usa montos siempre positivos (sin signo negativo) en el campo "amt".
- El campo "date" usa el formato del extracto tal cual aparece (o vacío si no es legible).
- El campo "category" debe ser EXACTAMENTE una de las etiquetas listadas arriba para esa sección — esto es crítico para que los subtotales anuales por categoría sean consistentes entre meses.
- El campo "detail" da contexto breve (ej. nombre del comercio, memo de la transacción).
- "period" es el rango de fechas del extracto tal como aparece (ej. "Enero 2026" o "01/01/2026 - 01/31/2026").
- "company" es el nombre del titular de la cuenta o negocio si aparece en el extracto; si no aparece, usa cadena vacía.`;

interface LineItem {
  date: string;
  desc: string;
  amt: number;
  category: string;
  detail: string;
}

const lineItemSchema = {
  type: "object",
  properties: {
    date: { type: "string" },
    desc: { type: "string" },
    amt: { type: "number" },
    category: { type: "string" },
    detail: { type: "string" },
  },
  required: ["date", "desc", "amt", "category", "detail"],
  additionalProperties: false,
};

const monthSchema = {
  type: "object",
  properties: {
    month: { type: "string" },
    revenue: { type: "number" },
    expenses: { type: "number" },
    net: { type: "number" },
  },
  required: ["month", "revenue", "expenses", "net"],
  additionalProperties: false,
};

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    company: { type: "string" },
    period: { type: "string" },
    industry: { type: "string" },
    annualYear: { type: "string" },
    revenues: { type: "array", items: lineItemSchema },
    cogs: { type: "array", items: lineItemSchema },
    opex: { type: "array", items: lineItemSchema },
    fees: { type: "array", items: lineItemSchema },
    personal: { type: "array", items: lineItemSchema },
    insights: { type: "array", items: { type: "string" } },
    alerts: { type: "array", items: { type: "string" } },
    annualSummary: { type: "array", items: monthSchema },
  },
  required: [
    "company", "period", "industry", "annualYear",
    "revenues", "cogs", "opex", "fees", "personal",
    "insights", "alerts", "annualSummary",
  ],
  additionalProperties: false,
};

const decodeBase64Text = (b64: string) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
};

const xlsxToText = (b64: string) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const wb = XLSX.read(bytes, { type: "array" });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    parts.push(`--- Sheet: ${sheetName} ---\n${XLSX.utils.sheet_to_csv(sheet)}`);
  }
  return parts.join("\n\n");
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { fileBase64, mediaType, fileName } = await req.json();

    if (!fileBase64 || typeof fileBase64 !== "string") {
      return new Response(JSON.stringify({ error: "Falta el archivo (fileBase64)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const normalizedType = String(mediaType || "").toLowerCase();
    const lowerName = String(fileName || "").toLowerCase();
    const isPdf = normalizedType.includes("pdf") || lowerName.endsWith(".pdf");
    const isXlsx = normalizedType.includes("sheet") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");

    let userContent: unknown[];

    if (isPdf) {
      userContent = [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: fileBase64 },
        },
        {
          type: "text",
          text: `Documento: ${fileName || "estado de cuenta"}. Analiza este extracto bancario completo y clasifica cada transacción según las instrucciones.`,
        },
      ];
    } else {
      const text = isXlsx ? xlsxToText(fileBase64) : decodeBase64Text(fileBase64);
      userContent = [
        {
          type: "text",
          text: `Documento: ${fileName || "estado de cuenta"}\n\nContenido:\n\n${text.slice(0, 180000)}\n\nAnaliza este extracto bancario completo y clasifica cada transacción según las instrucciones.`,
        },
      ];
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        thinking: { type: "disabled" },
        output_config: {
          format: { type: "json_schema", schema: RESULT_SCHEMA },
        },
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("analyze-statement Anthropic error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "El análisis con IA falló." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const completion = await response.json();

    if (completion.stop_reason === "refusal") {
      return new Response(JSON.stringify({ error: "El modelo no pudo procesar este documento." }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (completion.stop_reason === "max_tokens") {
      console.error("analyze-statement truncated: max_tokens reached", JSON.stringify(completion).slice(0, 500));
      return new Response(JSON.stringify({ error: "El extracto es demasiado largo para analizarlo de una vez. Intenta subirlo por separado o en partes más cortas." }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const textBlock = Array.isArray(completion.content)
      ? completion.content.find((b: any) => b.type === "text")
      : null;

    if (!textBlock?.text) {
      console.error("analyze-statement no text block. stop_reason:", completion.stop_reason, "content:", JSON.stringify(completion.content).slice(0, 500));
      throw new Error(`La respuesta de Claude no incluyó contenido de texto (stop_reason: ${completion.stop_reason || "desconocido"}).`);
    }

    const parsed = JSON.parse(textBlock.text);

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("analyze-statement error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
