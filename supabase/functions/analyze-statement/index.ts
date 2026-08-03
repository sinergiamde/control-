import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const buildSystemPrompt = (lang: string) => {
  const outputLang = lang === "en" ? "inglés americano (American English)" : "español latinoamericano neutro (sin modismos de España)";
  return `Eres un Contador, Analista Financiero y Preparador de Impuestos EXPERTO, especializado en pequeñas empresas en EE.UU. (Schedule C, LLCs, contratistas, construcción, trucking y servicios). Trabajas para CTRL+ by TaxForYou.

Tu objetivo es convertir el extracto bancario adjunto en datos financieros clasificados, listos para contabilidad y declaración de impuestos.

IDIOMA DE SALIDA: escribe los campos "insights", "alerts" y "detail" en ${outputLang}. El campo "category" es la ÚNICA excepción — SIEMPRE debe quedar exactamente en inglés, tal cual aparece en las listas de abajo, sin traducir, sin importar el idioma de salida (esto es necesario para que los subtotales por categoría sean consistentes entre extractos, sin importar el idioma en que se subieron).

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

REGLA DE COMIDA (importante): comida rápida, café o snacks durante jornada laboral → OPEX con category "Meals (work — fast food/coffee/snacks)". Restaurantes o bares → PERSONAL con category "Meals (restaurant/bar)". En el campo "detail" de cualquier transacción de comida, especifica (en el idioma de salida) si el comercio es un restaurante/bar o un supermercado/tienda, y el nombre del comercio si aparece.

REGLA DE TRANSFERENCIAS PERSONALES (importante): toda transferencia electrónica ("Online Transfer", "Electronic Withdrawal", transferencia a otra cuenta propia, etc.) sin justificación de negocio clara → PERSONAL con category "Personal bank transfer". En el campo "detail" indica el destino/origen tal como aparece en el extracto (nombre del beneficiario, banco/cuenta destino, o "transferencia a cuenta propia") — esto es indispensable para poder rastrear cada transferencia individualmente, ninguna puede quedar sin ese detalle.

Si algo no está claro, clasifícalo de todas formas en la categoría más probable (sin agregar una alerta individual por eso — las alertas se generan aparte, en el Paso 5, solo para patrones que de verdad importan).

Pagos por Zelle deben listarse individualmente (uno por transacción), nunca agrupados en las tablas de revenues/cogs/opex/fees/personal — pero en "alerts" sí deben agruparse por patrón (ver Paso 5).

IMPORTANTE — NO OMITAS NINGUNA TRANSACCIÓN: procesa absolutamente todas las líneas del extracto, incluyendo transferencias electrónicas banco-a-banco ("Online Transfer", "Electronic Withdrawal", transferencias a otra cuenta propia, etc.) — estas van en PERSONAL con category "Personal bank transfer" si no tienen justificación de negocio clara. Nunca dejes una transacción sin clasificar ni la excluyas del JSON final.

PASO 3 — Genera un resumen mensual (annualSummary): un registro por cada mes presente en el extracto, con ingresos, gastos y neto de ese mes. Si el extracto cubre un solo mes, igual genera esa única entrada.

PASO 4 — Genera "insights": 3 a 4 observaciones breves y accionables sobre la salud financiera del negocio (ej. margen bruto, categoría de mayor gasto, tendencia).

PASO 5 — Genera "alerts": MÁXIMO 5 alertas en total, priorizando solo lo que de verdad importa para el negocio o para impuestos:
  - Montos individuales grandes (>$500) sin descripción de negocio clara.
  - Patrones repetidos (ej. "múltiples pagos Zelle a individuos sin descripción de negocio, total $X" — UNA sola alerta agrupando todos esos casos, no una por transacción).
  - Posibles pagos duplicados.
  - Gastos personales grandes mezclados con la cuenta de negocio.
  No generes una alerta por cada transacción ambigua individual — agrupa. No agregues alertas para transacciones pequeñas, rutinarias o ya bien identificadas. Si de verdad no hay nada que reportar, incluye una sola nota breve indicando que todo está en orden (no la mezcles con las alertas de riesgo).

PASO 6 — Genera "thirdPartyPayments": UNA entrada por cada CHEQUE EMITIDO y por cada pago por ZELLE — tanto SALIENTE (el negocio paga) como ENTRANTE (un cliente le paga al negocio) — que ya hayas clasificado en el Paso 2, sin importar si quedó en REVENUES, COGS, OPEX o PERSONAL. Esto es indispensable para que el negocio sepa a quién debe reportarle un formulario 1099 al final del año, y para que ningún Zelle quede sin rastrear.
  - Para cheques emitidos: "method"="Check", "direction"="outgoing", "identifier"=el número de cheque exacto tal como aparece en el extracto (ej. "1787"). Si el extracto muestra el nombre del beneficiario del cheque, ponlo en "payee"; si no aparece (es común), deja "payee" como cadena vacía "". No generes entradas de tipo Check para cheques recibidos/depositados (esos van solo en revenues).
  - Para Zelle saliente: "method"="Zelle", "direction"="outgoing", "identifier"=nombre del destinatario tal como aparece, "payee"="".
  - Para Zelle entrante (ya clasificado en revenues con category "Zelle"): "method"="Zelle", "direction"="incoming", "identifier"=nombre del remitente/pagador tal como aparece, "payee"="".
  - Incluye "date", "amt" (positivo) y "category" (la misma categoría exacta que le asignaste a esa transacción en el Paso 2).
  - "classification": etiqueta muy breve (máx. 4-5 palabras, en el idioma de salida) sobre la relevancia de ese pago para reportes 1099 (ej. "Posible 1099 — subcontratista", "Pago de cliente", "Pago a familiar", "Reembolso").
  - "alert": cadena vacía "" salvo que ese pago puntual amerite una advertencia individual (ej. "Monto inusualmente alto para este beneficiario").
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
- El campo "detail" es OPCIONAL y debe ser muy breve (máx. 6 palabras, ej. nombre del comercio). Si no aporta nada útil, déjalo como cadena vacía "" — no rellenes con texto innecesario.
- "period" es el rango de fechas del extracto tal como aparece (ej. "Enero 2026" o "01/01/2026 - 01/31/2026").
- "company" es el nombre del titular de la cuenta o negocio si aparece en el extracto; si no aparece, usa cadena vacía.`;
};

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
    classification: { type: "string" },
    alert: { type: "string" },
  },
  required: [
    "method", "direction", "identifier", "payee", "date",
    "amt", "category", "classification", "alert",
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
    deposits: bankSummaryFieldSchema,
    checksPaid: bankSummaryFieldSchema,
    atmDebitWithdrawals: bankSummaryFieldSchema,
    electronicWithdrawals: bankSummaryFieldSchema,
    otherWithdrawals: bankSummaryFieldSchema,
  },
  required: [
    "found", "beginningBalance", "endingBalance",
    "deposits", "checksPaid", "atmDebitWithdrawals", "electronicWithdrawals", "otherWithdrawals",
  ],
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
    thirdPartyPayments: { type: "array", items: thirdPartyPaymentSchema },
    bankSummary: bankSummarySchema,
    insights: { type: "array", items: { type: "string" } },
    alerts: { type: "array", items: { type: "string" } },
    annualSummary: { type: "array", items: monthSchema },
  },
  required: [
    "company", "period", "industry", "annualYear",
    "revenues", "cogs", "opex", "fees", "personal", "thirdPartyPayments", "bankSummary",
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
    const { fileBase64, mediaType, fileName, lang } = await req.json();
    const outputLang = lang === "en" ? "en" : "es";

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
        max_tokens: 24000,
        system: [
          { type: "text", text: buildSystemPrompt(outputLang), cache_control: { type: "ephemeral" } },
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
