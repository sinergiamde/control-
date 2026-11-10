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
- "Refunds and returns"
- "Other income (specify)"

=== COGS (costo de ventas) — category debe ser una de: ===
- "Materials"
- "Supplies"
- "Storage"
- "Startup and moving costs"
- "Subcontractor costs"
- "Tolls (work)"
- "Permits"

=== OPEX (gastos operativos) — category debe ser una de: ===
- "Payroll"
- "Rent (lease or mortgage)"
- "Utilities (electric/water)"
- "Internet"
- "Business insurance"
- "Fuel (work)"
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
- "Credit card payment"
- "Business loan"

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

REGLA DE DEPÓSITOS = INGRESOS (importante, NUNCA la saltes): TODO el dinero que ENTRA a la cuenta es ingreso y va en REVENUES; el ingreso total del reporte debe ser exactamente igual a los depósitos totales que imprime el banco. Esto incluye las transferencias entrantes desde otras cuentas (ej. "Online Transfer... FROM ****XXXX", "Transfer Mobile FROM ****XXXX", "In-Branch Transfer... FROM ..."), aunque parezcan venir de una cuenta propia: van en REVENUES con category "Bank transfer". Un desembolso de línea de crédito (ej. "Credit Line ADV") también entra a la cuenta: va en REVENUES con category "Other income (specify)". En "detail_en"/"detail_es" anota el origen tal como aparece (ej. "transferencia desde la cuenta ****4612", "avance de línea de crédito"). NUNCA clasifiques un depósito como gasto (ni PERSONAL, ni OPEX, ni COGS, ni FEES): "Personal bank transfer" es solo para dinero que SALE de la cuenta.

REGLA DE TARJETA DE CRÉDITO Y PRÉSTAMOS DE NEGOCIO (importante): un pago SALIENTE que sea (a) el pago del saldo/mínimo de una tarjeta de crédito (ej. "Credit Card Pmt", "Online Credit Card Pmt", "Payment to ****XXXX" ligado a un emisor de tarjeta) → OPEX con category "Credit card payment"; o (b) el pago de una cuota de un préstamo/línea de crédito de negocio, incluyendo pagos a una línea de crédito rotativa (ej. "Credit Line Pmt", "Loan Payment", "Business Loan Pmt", "SBA Loan") → OPEX con category "Business loan". No los confundas con un AVANCE/desembolso de línea de crédito (ese es un depósito y sigue la regla de arriba, nunca es gasto); esto aplica solo a PAGOS salientes que reducen la deuda.

REGLA DE DEVOLUCIONES Y REEMBOLSOS (importante, NUNCA la saltes): un DEPÓSITO/crédito que sea la devolución, reembolso o reverso de un gasto de negocio que ya se había hecho (ej. "DEBIT CARD RETURN", "REFUND", "CREDIT ADJUSTMENT", "REVERSAL", casi siempre ligado al nombre de un proveedor/comercio) es dinero que vuelve a entrar a la cuenta, no un gasto — NUNCA lo clasifiques como gasto (ni PERSONAL, ni OPEX, ni COGS, ni FEES), eso invertiría la dirección real del dinero y haría que el resultado neto se vea peor de lo que realmente es. Clasifícalo en REVENUES con category "Refunds and returns" (el dinero regresó a la cuenta, por eso es ingreso y nunca gasto), sin importar el proveedor; también aplica a "PURCHASE RETURN", "MERCHANT CREDIT", "REVERSAL", "CREDIT ADJUSTMENT", "REFUND" y a "devolución"/"reembolso". (Un cargo por cheque devuelto o por fondos insuficientes SÍ es gasto bancario: eso no es una devolución.) En "detail_en"/"detail_es" aclara que es una devolución/reembolso de un gasto anterior y no un pago de cliente nuevo (ej. detail_en="Refund from [proveedor], not new revenue" / detail_es="Reembolso de [proveedor], no es ingreso nuevo").

Si algo no está claro, clasifícalo de todas formas en la categoría más probable (sin agregar una alerta individual por eso — las alertas se generan aparte, en el Paso 5, solo para patrones que de verdad importan).

Pagos por Zelle deben listarse individualmente (uno por transacción), nunca agrupados en las tablas de revenues/cogs/opex/fees/personal — pero en "alerts" sí deben agruparse por patrón (ver Paso 5).

CUADRE OBLIGATORIO CON EL BANCO (crítico: eres un analista financiero y de datos que no puede equivocarse con los números): antes de responder verifica con aritmética: (1) saldo inicial + depósitos totales − retiros totales = saldo final impreso por el banco; (2) la suma de revenues (TODO lo que ENTRA a la cuenta) debe ser igual a los depósitos totales del banco; (3) la suma de cogs + opex + fees + personal (TODO lo que SALE) debe ser igual a los retiros totales del banco. Si no cuadra, vuelve a revisar el extracto línea por línea hasta encontrar la transacción faltante, duplicada o mal clasificada. Nunca inventes ni ajustes un monto para que cuadre: copia cada número exactamente como lo imprime el banco.

FIDELIDAD AL EXTRACTO (obligatorio): el reporte debe reflejar EXACTAMENTE lo que dice el extracto del banco. Cada línea del extracto aparece UNA SOLA VEZ en UNA SOLA categoría: nunca repitas una transacción en dos listas ni la dividas. Si el extracto muestra dos transacciones idénticas (misma fecha, monto y comercio), son dos transacciones reales: inclúyelas las dos. Copia fecha, descripción y monto exactamente como aparecen, sin redondear ni corregir.

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
const accountInfoSchema = {
  type: "object",
  properties: {
    bankName: { type: "string" },
    accountHolder: { type: "string" },
    accountNumberLast4: { type: "string" },
    beginningBalance: { type: "number" },
    endingBalance: { type: "number" },
  },
  required: ["bankName", "accountHolder", "accountNumberLast4", "beginningBalance", "endingBalance"],
  additionalProperties: false,
};

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

const TRANSFER_IN_CATEGORY = "Transfer in (not income)";

const moneyNumber = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.abs(n) : 0;
};
const sumAmounts = (list: unknown) =>
  (Array.isArray(list) ? list : []).reduce((s: number, it: any) => s + moneyNumber(it?.amt), 0);
const printed = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);

// How far the classified transactions are from the totals the bank itself printed (null when the
// statement has no usable summary). deposits: bank - classified; withdrawals: classified - bank.
const reconcileGaps = (r: any) => {
  const b = r?.bankSummary;
  if (!b?.found) return null;
  const deposits = printed(b.deposits?.amount);
  if (deposits === null) return null;
  const parts = [b.checksPaid, b.atmDebitWithdrawals, b.electronicWithdrawals, b.otherWithdrawals].map((p: any) => printed(p?.amount));
  const opening = printed(b.beginningBalance);
  const closing = printed(b.endingBalance);
  const bankOut = parts.every((p) => p !== null)
    ? (parts as number[]).reduce((s, v) => s + v, 0)
    : opening !== null && closing !== null
    ? opening + deposits - closing
    : null;
  if (bankOut === null) return null;
  const personal = Array.isArray(r.personal) ? r.personal : [];
  const transfers = personal.filter((it: any) => it?.category === TRANSFER_IN_CATEGORY);
  const classifiedIn = sumAmounts(r.revenues) + sumAmounts(transfers);
  const classifiedOut = sumAmounts(r.cogs) + sumAmounts(r.opex) + sumAmounts(r.fees) + sumAmounts(personal) - sumAmounts(transfers);
  const depositsDelta = Math.round((deposits - classifiedIn) * 100) / 100;
  const withdrawalsDelta = Math.round((classifiedOut - bankOut) * 100) / 100;
  return { depositsDelta, withdrawalsDelta, score: Math.abs(depositsDelta) + Math.abs(withdrawalsDelta) };
};

// Model that classifies statements, set with the ANALYZE_MODEL secret (default Claude Sonnet 5 with
// thinking off: fast enough for long statements on the Free plan's 150 s limit). Claude Opus 5.5
// always thinks, so it gets an effort level (ANALYZE_EFFORT, default "low") and room for its thinking.
const STATEMENT_MODEL = Deno.env.get("ANALYZE_MODEL") || "claude-sonnet-5";
const THINKING_OFF = STATEMENT_MODEL === "claude-sonnet-5";
const modelSettings = (schema: unknown, maxTokens: number) =>
  THINKING_OFF
    ? { model: STATEMENT_MODEL, max_tokens: maxTokens, thinking: { type: "disabled" }, output_config: { format: { type: "json_schema", schema } } }
    : {
        model: STATEMENT_MODEL,
        max_tokens: Math.max(maxTokens * 2, 4000),
        fallbacks: "default",
        output_config: { effort: Deno.env.get("ANALYZE_EFFORT") || "low", format: { type: "json_schema", schema } },
      };
// The platform stops a function at its wall-clock limit (150 s on Supabase Free, 400 s on paid
// plans). Every AI call is aborted before that, so the person always gets an answer instead of a
// dropped connection. On a paid plan raise ANALYZE_DEADLINE_MS (e.g. 330000) in the function secrets.
const DEADLINE_MS = Number(Deno.env.get("ANALYZE_DEADLINE_MS") || 140_000);
// The bank-reconciliation second pass takes about as long as the first one: only start it when
// both fit before the deadline (about a third of it).
const RETRY_ONLY_BEFORE_MS = Number(Deno.env.get("ANALYZE_RETRY_BEFORE_MS") || Math.round(DEADLINE_MS / 3));

const ACCOUNT_INFO_PROMPT = `Lees extractos bancarios. Extrae SOLO los datos de la cuenta tal como los imprime el banco en el encabezado o primera página; cópialos exactos, nunca los calcules ni los infieras:
- bankName: nombre del banco ("" si no aparece).
- accountHolder: titular de la cuenta tal como aparece ("" si no aparece).
- accountNumberLast4: SOLO los últimos 4 dígitos del número de cuenta, nunca el número completo ("" si no aparecen).
- beginningBalance: saldo inicial / anterior impreso ("Beginning Balance", "Previous Balance", "Opening Balance", "Saldo anterior"); puede ser negativo si hay sobregiro. Usa -999999999 (nunca 0) si NO está impreso.
- endingBalance: saldo final impreso ("Ending Balance", "Saldo final"). Usa -999999999 si NO está impreso.`;

/** An error whose message is already written for the person who uploaded the statement. */
class UserFacingError extends Error {}

const TIMEOUT_MESSAGE =
  "El análisis tardó demasiado y se detuvo antes de terminar. Vuelve a intentarlo en un momento; si el extracto tiene muchas páginas, súbelo por meses o en partes más cortas.";

const userMessageFor = (error: unknown): string => {
  if (error instanceof UserFacingError) return error.message;
  if ((error as { name?: string })?.name === "AbortError") return TIMEOUT_MESSAGE;
  return "No se pudo completar el análisis por un error inesperado. Vuelve a intentarlo; si se repite, avísale al administrador.";
};

const anthropicErrorMessage = (status: number, body: string): string => {
  const t = body.toLowerCase();
  if (t.includes("credit balance")) return "La cuenta de la IA se quedó sin saldo. Avísale al administrador para que la recargue.";
  if (status === 429 || status === 529 || t.includes("overloaded")) return "El servicio de IA está saturado en este momento. Espera un minuto y vuelve a intentarlo.";
  if (status === 401 || status === 403) return "El servidor no pudo conectarse con la IA (clave de acceso rechazada). Avísale al administrador.";
  if (!t.includes("grammar") && (status === 413 || t.includes("too long") || t.includes("too large"))) {
    return "El extracto es demasiado grande para analizarlo de una vez. Súbelo por meses o en partes más cortas.";
  }
  return `El análisis con IA falló (código ${status}). Vuelve a intentarlo en un momento; si se repite, avísale al administrador.`;
};

/** One call to Claude, aborted at `deadlineAt` (epoch ms). Never throws for HTTP errors. */
const callClaude = async (apiKey: string, body: Record<string, unknown>, deadlineAt: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - Date.now()));
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        ...("fallbacks" in body ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
};

const firstText = (completion: any): string | null =>
  Array.isArray(completion?.content) ? completion.content.find((b: any) => b.type === "text")?.text ?? null : null;

const runAnalysis = async (apiKey: string, userContent: unknown[], startedAt: number) => {
  const deadlineAt = startedAt + DEADLINE_MS;

  // Account details come from a second, tiny request running in parallel: the main schema is already
  // at the provider's grammar size limit, so adding fields there makes the whole analysis fail.
  const accountPromise = callClaude(apiKey, {
    ...modelSettings(accountInfoSchema, 600),
    system: ACCOUNT_INFO_PROMPT,
    messages: [{ role: "user", content: userContent }],
  }, deadlineAt)
    .then((r) => (r.ok ? firstText(JSON.parse(r.text)) : null))
    .then((text) => (text ? JSON.parse(text) : null))
    .catch(() => null);

  const mainRequest = {
    ...modelSettings(RESULT_SCHEMA, 32000),
    system: [{ type: "text", text: buildSystemPrompt(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
  };

  const first = await callClaude(apiKey, mainRequest, deadlineAt);
  if (!first.ok) {
    console.error("analyze-statement Anthropic error:", first.status, first.text.slice(0, 1000));
    throw new UserFacingError(anthropicErrorMessage(first.status, first.text));
  }
  const completion = JSON.parse(first.text);
  if (completion.stop_reason === "refusal") {
    throw new UserFacingError("La IA no pudo leer este documento. Verifica que sea el extracto bancario original en PDF (no una foto borrosa ni un archivo protegido) y vuelve a intentarlo.");
  }
  if (completion.stop_reason === "max_tokens") {
    console.error("analyze-statement truncated: max_tokens reached", JSON.stringify(completion.usage ?? {}));
    throw new UserFacingError("El extracto tiene demasiadas transacciones para analizarlo de una vez. Súbelo por meses o en partes más cortas.");
  }
  const text = firstText(completion);
  if (!text) {
    console.error("analyze-statement no text block. stop_reason:", completion.stop_reason);
    throw new UserFacingError("La IA no devolvió resultados para este documento. Vuelve a intentarlo.");
  }
  const parsed = JSON.parse(text);
  parsed.accountInfo = (await accountPromise) ?? null;

  // Self-check against the bank's own totals. If the classified transactions don't add up to what the
  // bank printed, ask the model once to find what is missing or misfiled, and keep whichever result
  // reconciles better. Only when there is time for it; an aborted second pass keeps the first result.
  let finalResult: any = parsed;
  const gapsFirst = reconcileGaps(parsed);
  if (gapsFirst && gapsFirst.score > 1 && Date.now() - startedAt < RETRY_ONLY_BEFORE_MS) {
    try {
      const retry = await callClaude(apiKey, {
        ...mainRequest,
        messages: [
          { role: "user", content: userContent },
          { role: "assistant", content: text },
          {
            role: "user",
            content: `El resultado anterior NO cuadra con los totales impresos por el banco. Depósitos del banco menos depósitos clasificados = ${gapsFirst.depositsDelta} (positivo = faltan ingresos o entradas). Retiros clasificados menos retiros del banco = ${gapsFirst.withdrawalsDelta} (positivo = sobran gastos). Revisa el extracto línea por línea y encuentra las transacciones faltantes, duplicadas o mal clasificadas. Recuerda: TODO el dinero que ENTRA a la cuenta (incluidas transferencias desde otras cuentas) va en REVENUES; nunca como gasto. Nunca inventes ni ajustes un monto para que cuadre. Devuelve el JSON COMPLETO corregido.`,
          },
        ],
      }, deadlineAt);
      if (retry.ok) {
        const retryCompletion = JSON.parse(retry.text);
        const retryText = retryCompletion.stop_reason === "end_turn" ? firstText(retryCompletion) : null;
        if (retryText) {
          const candidate = JSON.parse(retryText);
          const gapsRetry = reconcileGaps(candidate);
          if (gapsRetry && gapsRetry.score < gapsFirst.score) {
            candidate.accountInfo = parsed.accountInfo;
            finalResult = candidate;
          }
        }
      }
    } catch (retryError) {
      console.error("analyze-statement verification retry skipped:", retryError);
    }
  }
  const gapsFinal = reconcileGaps(finalResult);
  finalResult.verification = {
    checked: gapsFinal !== null,
    depositsDelta: gapsFinal?.depositsDelta ?? null,
    withdrawalsDelta: gapsFinal?.withdrawalsDelta ?? null,
    retried: finalResult !== parsed,
    model: STATEMENT_MODEL,
  };
  return finalResult;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // This call runs a full statement analysis through Claude — real per-call cost. Requiring a
    // logged-in user (not just the public anon key any visitor can read from the built JS bundle)
    // stops anyone off the internet from scripting free/unlimited analyses on our AI budget.
    const requestStartedAt = Date.now();
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
    // Once the 24-hour trial is over (and no subscription), stop before spending on the AI — saving
    // the result would be refused by the database anyway.
    const { data: allowed } = await supabaseClient.rpc("can_analyze");
    if (allowed === false) {
      return new Response(JSON.stringify({ error: "Tu prueba gratuita terminó. Suscríbete para seguir analizando extractos." }), {
        status: 402,
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
      console.error("analyze-statement: ANTHROPIC_API_KEY is not configured");
      throw new UserFacingError("El servidor todavía no tiene configurada la clave de la IA. Avísale al administrador.");
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

    // From here the work takes a while (often more than a minute). The platform drops a request that
    // has sent nothing for 150 s, so the answer starts streaming now: a space every few seconds keeps
    // it alive (leading spaces are valid JSON) and the result, or a clear error, is written at the end.
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // the person closed the page; nothing to send to
          }
        };
        send(" ");
        const keepAlive = setInterval(() => send(" "), 5000);
        let payload: unknown;
        try {
          payload = await runAnalysis(ANTHROPIC_API_KEY, userContent, requestStartedAt);
        } catch (error) {
          console.error("analyze-statement error:", error);
          payload = { error: userMessageFor(error) };
        } finally {
          clearInterval(keepAlive);
        }
        send(JSON.stringify(payload));
        try {
          controller.close();
        } catch {
          // already closed
        }
      },
    });
    return new Response(body, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("analyze-statement error:", error);
    return new Response(JSON.stringify({ error: userMessageFor(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
