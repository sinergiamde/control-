import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const buildSystemPrompt = () => {
  return `Eres un Contador, Analista Financiero y Preparador de Impuestos EXPERTO, especializado en pequeñas empresas en EE.UU. (Schedule C, LLCs, contratistas, construcción, trucking y servicios). Trabajas para CTRL+ by TaxForYou.

Tu objetivo es convertir el extracto bancario adjunto en datos financieros clasificados, listos para contabilidad y declaración de impuestos.

IDIOMA DE SALIDA: la aplicación permite ver cada reporte en inglés o en español, así que TODO campo de texto libre debe generarse en AMBOS idiomas a la vez, en dos campos paralelos con sufijo "_en" y "_es" (ej. "detail_en" y "detail_es", "insights_en" e "insights_es", "alerts_en" y "alerts_es", "classification_en"/"classification_es", "alert_en"/"alert_es" en thirdPartyPayments, "period_en"/"period_es"). Ambas versiones deben decir exactamente lo mismo, solo cambia el idioma — "_en" en inglés americano (American English), "_es" en español latinoamericano neutro (sin modismos de España). El campo "category" es la ÚNICA excepción — SIEMPRE debe quedar exactamente en inglés, tal cual aparece en las listas de abajo, sin traducir, en un solo campo (no lleva _en/_es), sin importar lo anterior (esto es necesario para que los subtotales por categoría sean consistentes entre extractos, sin importar el idioma en que se subieron).

PASO 1 — DETECTA la industria del negocio (Construcción/Drywall/Remodelación, Transporte/Trucking, Servicios de limpieza, Retail/Reventa, Servicios profesionales, u "Negocio General" si no está claro) según los proveedores y patrones de transacciones. Ajusta la clasificación de gastos según esa industria.

PASO 2 — Clasifica CADA transacción del extracto (no omitas ninguna transacción, procesa el extracto completo). El campo "category" de cada línea DEBE ser EXACTAMENTE una de las etiquetas en INGLÉS de la lista correspondiente de abajo (no inventes etiquetas nuevas, no las traduzcas; si de verdad ninguna aplica, usa "Other (specify)" y agrega una alerta).

=== INCOME (revenues) — category debe ser una de: ===
- "Bank transfer"
- "Wire transfer"
- "Zelle"
- "Check"
- "Cash deposit"
- "Other income (specify)"

=== COGS (costo de ventas) — category debe ser una de: ===
- "Materials"
- "Supplies"
- "Storage"
- "Startup and moving costs"
- "Subcontractor costs"
- "Fuel (work)"
- "Tolls (work)"
- "Permits"

=== OPEX (gastos operativos) — category debe ser una de: ===
- "Payroll"
- "Rent (lease or mortgage)"
- "Utilities (electric/water)"
- "Internet"
- "Business insurance"
- "Parking"
- "Car insurance"
- "Car payment"
- "Repairs and maintenance"
- "Vehicle expenses"
- "Marketing and advertising"
- "Subscriptions and membership dues"
- "Business software"
- "Website and hosting"
- "Training and development"
- "Licenses and permits"
- "Legal and compliance fees"
- "Professional services"
- "Office supplies"
- "Office furniture and equipment"
- "Operating costs"
- "Bad debts or loans"
- "Travel expenses"
- "Hotels or lodging"
- "Meals (work — fast food/coffee/snacks)"

=== FEES (comisiones/cargos bancarios) — category debe ser una de: ===
- "Bank fees"

=== PERSONAL (no deducible) — category debe ser una de: ===
- "Clothing"
- "Entertainment"
- "Personal purchases"
- "Zelle to family (no business justification)"
- "Personal bank transfer"
- "Health / personal services"
- "Meals (restaurant/bar)"
- "Other personal (specify)"

REGLA DE COMIDA (importante): comida rápida, café o snacks durante jornada laboral → OPEX con category "Meals (work — fast food/coffee/snacks)". Restaurantes o bares → PERSONAL con category "Meals (restaurant/bar)". En los campos "detail_en" y "detail_es" de cualquier transacción de comida, especifica (en cada idioma respectivamente) si el comercio es un restaurante/bar o un supermercado/tienda, y el nombre del comercio si aparece.

REGLA DE TRANSFERENCIAS PERSONALES (importante): toda transferencia electrónica ("Online Transfer", "Electronic Withdrawal", transferencia a otra cuenta propia, etc.) sin justificación de negocio clara → PERSONAL con category "Personal bank transfer". En los campos "detail_en" y "detail_es" indica el destino/origen tal como aparece en el extracto (nombre del beneficiario, banco/cuenta destino, o "transfer to own account"/"transferencia a cuenta propia") — esto es indispensable para poder rastrear cada transferencia individualmente, ninguna puede quedar sin ese detalle.

Si algo no está claro, clasifícalo de todas formas en la categoría más probable (sin agregar una alerta individual por eso — las alertas se generan aparte, en el Paso 5, solo para patrones que de verdad importan).

Pagos por Zelle deben listarse individualmente (uno por transacción), nunca agrupados en las tablas de revenues/cogs/opex/fees/personal — pero en "alerts" sí deben agruparse por patrón (ver Paso 5).

IMPORTANTE — NO OMITAS NINGUNA TRANSACCIÓN: procesa absolutamente todas las líneas del extracto, incluyendo transferencias electrónicas banco-a-banco ("Online Transfer", "Electronic Withdrawal", transferencias a otra cuenta propia, etc.) — estas van en PERSONAL con category "Personal bank transfer" si no tienen justificación de negocio clara. Nunca dejes una transacción sin clasificar ni la excluyas del JSON final.

PASO 3 — Genera un resumen mensual (annualSummary): un registro por cada mes presente en el extracto, con ingresos, gastos y neto de ese mes. Si el extracto cubre un solo mes, igual genera esa única entrada.

PASO 4 — Genera "insights_en" e "insights_es": 3 a 4 observaciones breves y accionables sobre la salud financiera del negocio (ej. margen bruto, categoría de mayor gasto, tendencia). Ambos arreglos deben decir exactamente lo mismo, uno en inglés y otro en español.

PASO 5 — Genera "alerts_en" y "alerts_es": MÁXIMO 5 alertas en total, priorizando solo lo que de verdad importa para el negocio o para impuestos (ambos arreglos con el mismo contenido, uno por idioma):
  - Montos individuales grandes (>$500) sin descripción de negocio clara.
  - Patrones repetidos (ej. "múltiples pagos Zelle a individuos sin descripción de negocio, total $X" — UNA sola alerta agrupando todos esos casos, no una por transacción).
  - Posibles pagos duplicados.
  - Gastos personales grandes mezclados con la cuenta de negocio.
  No generes una alerta por cada transacción ambigua individual — agrupa. No agregues alertas para transacciones pequeñas, rutinarias o ya bien identificadas. Si de verdad no hay nada que reportar, incluye una sola nota breve (en ambos idiomas) indicando que todo está en orden (no la mezcles con las alertas de riesgo).

PASO 6 — Genera "thirdPartyPayments": UNA entrada por cada CHEQUE EMITIDO y por cada pago por ZELLE — tanto SALIENTE (el negocio paga) como ENTRANTE (un cliente le paga al negocio) — que ya hayas clasificado en el Paso 2, sin importar si quedó en REVENUES, COGS, OPEX o PERSONAL. Esto es indispensable para que el negocio sepa a quién debe reportarle un formulario 1099 al final del año, y para que ningún Zelle quede sin rastrear.
  - Para cheques emitidos: "method"="Check", "direction"="outgoing", "identifier"=el número de cheque exacto tal como aparece en el extracto (ej. "1787"). Si el extracto muestra el nombre del beneficiario del cheque, ponlo en "payee"; si no aparece (es común), deja "payee" como cadena vacía "". No generes entradas de tipo Check para cheques recibidos/depositados (esos van solo en revenues).
  - Para Zelle saliente: "method"="Zelle", "direction"="outgoing", "identifier"=nombre del destinatario tal como aparece, "payee"="".
  - Para Zelle entrante (ya clasificado en revenues con category "Zelle"): "method"="Zelle", "direction"="incoming", "identifier"=nombre del remitente/pagador tal como aparece, "payee"="".
  - Incluye "date", "amt" (positivo) y "category" (la misma categoría exacta que le asignaste a esa transacción en el Paso 2).
  - "classification_en" y "classification_es": etiqueta muy breve (máx. 4-5 palabras, mismo contenido en ambos idiomas) sobre la relevancia de ese pago para reportes 1099 (ej. "Possible 1099 — subcontractor" / "Posible 1099 — subcontratista", "Client payment" / "Pago de cliente", "Payment to family" / "Pago a familiar", "Reimbursement" / "Reembolso").
  - "alert_en" y "alert_es": cadena vacía "" en ambos salvo que ese pago puntual amerite una advertencia individual (ej. "Unusually high amount for this payee" / "Monto inusualmente alto para este beneficiario").
  - Si el mismo número de cheque o la misma persona recibe/envía varios pagos, lista cada uno por separado (no los sumes en una sola entrada).

PASO 7 — Busca en el extracto un recuadro de resumen impreso por el propio banco (ej. "Checking Summary", "Account Summary") con Saldo inicial, Depósitos y adiciones, Cheques pagados, Retiros con tarjeta/ATM, Retiros electrónicos y Saldo final — casi siempre con instancias y monto de cada uno. Genera "bankSummary" copiando esos valores TAL COMO los imprime el banco — NUNCA los calcules ni los infieras sumando las transacciones que ya clasificaste, es una verificación cruzada independiente para detectar transacciones que se te hayan escapado.
  - Si el recuadro existe: "found"=true, y llena cada campo presente con el número exacto impreso.
  - Si un campo específico no aparece impreso por separado (ej. el banco no distingue "Retiros electrónicos" de otros retiros — usa "otherWithdrawals" para retiros que no encajen en las demás categorías del resumen del banco): usa -1 tanto en "instances" como en "amount" de ese campo — NUNCA uses 0, porque 0 significaría que el banco reportó cero.
  - Si el extracto no trae ningún recuadro de resumen del banco: "found"=false y usa -1 en TODOS los campos numéricos de "bankSummary".

REGLAS OBLIGATORIAS:
- No inventes transacciones que no estén en el documento.
- No omitas transacciones, procesa el extracto completo.
- Usa montos siempre positivos (sin signo negativo) en el campo "amt".
- El campo "date" usa el formato del extracto tal cual aparece (o vacío si no es legible).
- El campo "category" debe ser EXACTAMENTE una de las etiquetas listadas arriba para esa sección — esto es crítico para que los subtotales anuales por categoría sean consistentes entre meses.
- Los campos "detail_en" y "detail_es" son OPCIONALES y deben ser muy breves (máx. 6 palabras, ej. nombre del comercio). Si no aportan nada útil, déjalos como cadena vacía "" en ambos — no rellenes con texto innecesario.
- "period" es el rango de fechas del extracto tal como aparece (ej. "Enero 2026" o "01/01/2026 - 01/31/2026") — este campo es interno (para agrupar extractos), no se le muestra al usuario, así que no necesita traducción.
- "period_en" y "period_es" SÍ se le muestran al usuario, así que deben ser una versión legible del mismo rango de fechas, redactada en cada idioma con el nombre del mes escrito (nunca uses nombres de mes en inglés en "period_es" ni viceversa) — ej. si el extracto cubre del 1 al 28 de febrero de 2025: "period_en"="February 1, 2025 through February 28, 2025", "period_es"="1 de febrero de 2025 al 28 de febrero de 2025". Si el extracto solo trae un mes/año sin días exactos, usa igual el formato largo en cada idioma (ej. "period_en"="February 2025", "period_es"="Febrero 2025").
- "company" es el nombre del titular de la cuenta o negocio si aparece en el extracto; si no aparece, usa cadena vacía.`;
};

interface LineItem {
  date: string;
  desc: string;
  amt: number;
  category: string;
  detail_en: string;
  detail_es: string;
}

const lineItemSchema = {
  type: "object",
  properties: {
    date: { type: "string" },
    desc: { type: "string" },
    amt: { type: "number" },
    category: { type: "string" },
    detail_en: { type: "string" },
    detail_es: { type: "string" },
  },
  required: ["date", "desc", "amt", "category", "detail_en", "detail_es"],
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

const thirdPartyPaymentSchema = {
  type: "object",
  properties: {
    method: { type: "string" },
    direction: { type: "string" },
    identifier: { type: "string" },
    payee: { type: "string" },
    date: { type: "string" },
    amt: { type: "number" },
    category: { type: "string" },
    classification_en: { type: "string" },
    classification_es: { type: "string" },
    alert_en: { type: "string" },
    alert_es: { type: "string" },
  },
  required: [
    "method", "direction", "identifier", "payee", "date",
    "amt", "category", "classification_en", "classification_es", "alert_en", "alert_es",
  ],
  additionalProperties: false,
};

const bankSummaryFieldSchema = {
  type: "object",
  properties: {
    instances: { type: "number" },
    amount: { type: "number" },
  },
  required: ["instances", "amount"],
  additionalProperties: false,
};

const bankSummarySchema = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    beginningBalance: { type: "number" },
    endingBalance: { type: "number" },
    deposits: { $ref: "#/$defs/bankSummaryField" },
    checksPaid: { $ref: "#/$defs/bankSummaryField" },
    atmDebitWithdrawals: { $ref: "#/$defs/bankSummaryField" },
    electronicWithdrawals: { $ref: "#/$defs/bankSummaryField" },
    otherWithdrawals: { $ref: "#/$defs/bankSummaryField" },
  },
  required: [
    "found", "beginningBalance", "endingBalance",
    "deposits", "checksPaid", "atmDebitWithdrawals", "electronicWithdrawals", "otherWithdrawals",
  ],
  additionalProperties: false,
};

// lineItemSchema/thirdPartyPaymentSchema/etc. are each reused across several array fields below
// (revenues/cogs/opex/fees/personal all share lineItemSchema, bankSummarySchema reuses
// bankSummaryFieldSchema 5x). Inlining the same object literally that many times bloats the JSON
// sent to the model enough to hit Claude's "compiled grammar is too large" limit for structured
// outputs — so every field that reuses a schema points at a single $defs entry via $ref instead of
// embedding a fresh copy each time.
const RESULT_SCHEMA = {
  type: "object",
  $defs: {
    lineItem: lineItemSchema,
    thirdPartyPayment: thirdPartyPaymentSchema,
    bankSummaryField: bankSummaryFieldSchema,
    bankSummary: bankSummarySchema,
    month: monthSchema,
  },
  properties: {
    company: { type: "string" },
    period: { type: "string" },
    period_en: { type: "string" },
    period_es: { type: "string" },
    industry: { type: "string" },
    annualYear: { type: "string" },
    revenues: { type: "array", items: { $ref: "#/$defs/lineItem" } },
    cogs: { type: "array", items: { $ref: "#/$defs/lineItem" } },
    opex: { type: "array", items: { $ref: "#/$defs/lineItem" } },
    fees: { type: "array", items: { $ref: "#/$defs/lineItem" } },
    personal: { type: "array", items: { $ref: "#/$defs/lineItem" } },
    thirdPartyPayments: { type: "array", items: { $ref: "#/$defs/thirdPartyPayment" } },
    bankSummary: { $ref: "#/$defs/bankSummary" },
    insights_en: { type: "array", items: { type: "string" } },
    insights_es: { type: "array", items: { type: "string" } },
    alerts_en: { type: "array", items: { type: "string" } },
    alerts_es: { type: "array", items: { type: "string" } },
    annualSummary: { type: "array", items: { $ref: "#/$defs/month" } },
  },
  required: [
    "company", "period", "period_en", "period_es", "industry", "annualYear",
    "revenues", "cogs", "opex", "fees", "personal", "thirdPartyPayments", "bankSummary",
    "insights_en", "insights_es", "alerts_en", "alerts_es", "annualSummary",
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
    // This call runs a full statement analysis through Claude — real per-call cost. Requiring a
    // logged-in user (not just the public anon key any visitor can read from the built JS bundle)
    // stops anyone off the internet from scripting free/unlimited analyses on our AI budget.
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Debes iniciar sesión para analizar un extracto." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        max_tokens: 32000,
        system: [
          { type: "text", text: buildSystemPrompt(), cache_control: { type: "ephemeral" } },
        ],
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
